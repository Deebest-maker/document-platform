"""Abuse controls on the public job API (M7B, ADR-033).

Each test builds an app with the small limits it wants to exercise; the shared
fixture in conftest.py relaxes them for tests of other behaviour.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.jobs import JobsContext, _receive_input
from app.config import Settings
from app.errors import ErrorCode, ProcessorError
from app.jobs.auth import hash_token
from app.jobs.janitor import Janitor
from app.jobs.state import JobState
from app.jobs.store import InMemoryJobStore
from app.main import create_app

from .helpers import _bearer, _create, _minimal_docx


def _settings(tmp_path: Path, **overrides: Any) -> Settings:
    jobs_root = tmp_path / "jobs"
    jobs_root.mkdir(exist_ok=True)
    (jobs_root / ".sentinel").write_text("ok")
    values: dict[str, Any] = {
        "environment": "test",
        "jobs_root": jobs_root,
        "jobs_root_sentinel": ".sentinel",
        "max_input_bytes": 1024,
        "max_output_bytes": 1024 * 1024,
        "job_lifetime_seconds": 3600,
        "runner_timeout_seconds": 5,
        "janitor_interval_seconds": 3600,
        "max_inflight_jobs": 8,
        "job_create_burst": 3,
        "job_create_refill_seconds": 30,
        "max_active_jobs_per_client": 2,
    }
    values.update(overrides)
    return Settings(**values)


@contextmanager
def _client(tmp_path: Path, **overrides: Any) -> Iterator[TestClient]:
    with TestClient(create_app(settings=_settings(tmp_path, **overrides))) as client:
        yield client


def _post(client: TestClient, forwarded: str | None = None) -> Any:
    headers = {"X-Forwarded-For": forwarded} if forwarded else {}
    return client.post("/v1/jobs", json={"tool": "word-to-pdf"}, headers=headers)


# ── Creation rate ───────────────────────────────────────────────────────


def test_creation_beyond_the_burst_is_refused_with_a_wait(tmp_path: Path) -> None:
    with _client(tmp_path, max_active_jobs_per_client=50) as client:
        assert [_post(client).status_code for _ in range(3)] == [201, 201, 201]
        refused = _post(client)
        assert refused.status_code == 429
        assert refused.json()["detail"]["code"] == "rate_limited"
        wait = int(refused.headers["Retry-After"])
        assert 1 <= wait <= 30


def test_a_refusal_creates_no_job(tmp_path: Path) -> None:
    with _client(tmp_path, max_active_jobs_per_client=50) as client:
        for _ in range(3):
            _post(client)
        store = client.app.state.jobs.store  # type: ignore[attr-defined]
        assert len(store) == 3
        _post(client)
        assert len(store) == 3


def test_other_callers_are_not_affected_when_a_proxy_is_trusted(
    tmp_path: Path,
) -> None:
    with _client(tmp_path, trusted_proxy_hops=1, max_active_jobs_per_client=50) as c:
        for _ in range(3):
            assert _post(c, "203.0.113.1").status_code == 201
        assert _post(c, "203.0.113.1").status_code == 429
        assert _post(c, "203.0.113.2").status_code == 201


def test_a_spoofed_forwarded_header_does_not_buy_a_new_budget(
    tmp_path: Path,
) -> None:
    """No trusted proxy: the header is client-controlled and must be ignored."""
    with _client(tmp_path, trusted_proxy_hops=0, max_active_jobs_per_client=50) as c:
        results = [_post(c, f"198.51.100.{n}").status_code for n in range(1, 6)]
    assert results == [201, 201, 201, 429, 429]


def test_with_a_trusted_proxy_only_the_proxy_appended_entry_counts(
    tmp_path: Path,
) -> None:
    with _client(tmp_path, trusted_proxy_hops=1, max_active_jobs_per_client=50) as c:
        results = [
            # Same real caller, different made-up leading entries.
            _post(c, f"6.6.6.{n}, 203.0.113.1").status_code
            for n in range(1, 6)
        ]
    assert results == [201, 201, 201, 429, 429]


# ── Active jobs per caller ──────────────────────────────────────────────


def test_a_caller_cannot_hold_more_than_its_share_of_active_jobs(
    tmp_path: Path,
) -> None:
    with _client(tmp_path, job_create_burst=50) as client:
        first = _create(client)
        _create(client)
        refused = _post(client)
        assert refused.status_code == 429
        assert refused.json()["detail"]["code"] == "rate_limited"
        assert int(refused.headers["Retry-After"]) >= 1
        # Finishing with a job frees the share.
        client.delete(f"/v1/jobs/{first[0]}", headers=_bearer(first[1]))
        assert _post(client).status_code == 201


def test_one_caller_filling_its_share_leaves_room_for_others(tmp_path: Path) -> None:
    with _client(tmp_path, trusted_proxy_hops=1, job_create_burst=50) as client:
        for _ in range(2):
            assert _post(client, "203.0.113.1").status_code == 201
        assert _post(client, "203.0.113.1").status_code == 429
        assert _post(client, "203.0.113.2").status_code == 201


def test_the_whole_service_being_full_is_503_not_429(tmp_path: Path) -> None:
    """Different callers fill the service: that is the service's limit, not the
    caller's, and the two are reported differently."""
    with _client(
        tmp_path,
        trusted_proxy_hops=1,
        max_inflight_jobs=2,
        max_active_jobs_per_client=2,
        job_create_burst=50,
    ) as client:
        assert _post(client, "203.0.113.1").status_code == 201
        assert _post(client, "203.0.113.2").status_code == 201
        full = _post(client, "203.0.113.3")
        assert full.status_code == 503
        assert full.json()["detail"]["code"] == "not_ready"
        assert "Retry-After" not in full.headers


def test_finished_jobs_do_not_count_against_the_active_share(tmp_path: Path) -> None:
    with _client(
        tmp_path,
        job_create_burst=50,
        max_active_jobs_per_client=1,
        max_input_bytes=1024 * 1024,
    ) as client:
        job_id, token = _create(client)
        assert _post(client).status_code == 429  # the one share is in use
        upload = client.put(
            f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=_minimal_docx()
        )
        assert upload.status_code == 200
        convert = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
        assert convert.status_code == 200
        assert convert.json()["state"] == "succeeded"
        # The finished job no longer holds the share.
        assert _post(client).status_code == 201


# ── Uploads ──────────────────────────────────────────────────────────────


def test_an_oversize_body_is_refused_and_leaves_nothing_behind(
    tmp_path: Path,
) -> None:
    with _client(tmp_path, max_input_bytes=1024) as client:
        job_id, token = _create(client)
        response = client.put(
            f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=b"x" * 2048
        )
        assert response.status_code == 413
        assert response.json()["detail"]["code"] == "limit_exceeded"
        jobs_root = tmp_path / "jobs"
        assert [p.name for p in jobs_root.iterdir()] == [".sentinel"]
        # The job is still usable: a body that fits is accepted.
        retry = client.put(
            f"/v1/jobs/{job_id}/input",
            headers=_bearer(token),
            content=b"PK" + b"x" * 40,
        )
        assert retry.status_code == 200


def test_a_declared_length_over_the_limit_is_refused_before_reading(
    tmp_path: Path,
) -> None:
    with _client(tmp_path, max_input_bytes=1024) as client:
        job_id, token = _create(client)
        response = client.put(
            f"/v1/jobs/{job_id}/input",
            headers={**_bearer(token), "Content-Length": "99999999"},
            content=b"tiny",
        )
        assert response.status_code == 413
        assert [p.name for p in (tmp_path / "jobs").iterdir()] == [".sentinel"]


def test_a_malformed_declared_length_is_refused(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        job_id, token = _create(client)
        response = client.put(
            f"/v1/jobs/{job_id}/input",
            headers={**_bearer(token), "Content-Length": "12abc"},
            content=b"tiny",
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_input"


def test_a_second_upload_while_one_is_arriving_is_a_conflict(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        job_id, token = _create(client)
        client.app.state.jobs.uploading.add(job_id)  # type: ignore[attr-defined]
        response = client.put(
            f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=b"PK"
        )
        assert response.status_code == 409
        # The refused upload must not have damaged the job or the guard.
        assert job_id in client.app.state.jobs.uploading  # type: ignore[attr-defined]
        state = client.get(f"/v1/jobs/{job_id}", headers=_bearer(token)).json()
        assert state["state"] == "created"


def test_the_upload_guard_is_released_after_every_outcome(tmp_path: Path) -> None:
    with _client(tmp_path, max_input_bytes=1024) as client:
        ctx = client.app.state.jobs  # type: ignore[attr-defined]
        job_id, token = _create(client)
        client.put(f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=b"")
        assert job_id not in ctx.uploading  # empty body
        client.put(
            f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=b"x" * 5000
        )
        assert job_id not in ctx.uploading  # too large
        ok = client.put(
            f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=b"PK" + b"x" * 9
        )
        assert ok.status_code == 200
        assert job_id not in ctx.uploading  # success


# ── The body is streamed, not buffered ───────────────────────────────────


class _FakeRequest:
    """Just enough of a Request: an async body stream that records how far it was
    read."""

    def __init__(
        self, chunks: list[bytes], *, then_hang: bool = False, delay: float = 0.0
    ) -> None:
        self.chunks = chunks
        self.then_hang = then_hang
        self.delay = delay
        self.delivered = 0

    def stream(self) -> AsyncIterator[bytes]:
        async def generate() -> AsyncIterator[bytes]:
            for chunk in self.chunks:
                if self.delay:
                    await asyncio.sleep(self.delay)
                self.delivered += 1
                yield chunk
            if self.then_hang:
                await asyncio.sleep(3600)

        return generate()


def _context(tmp_path: Path, **overrides: Any) -> tuple[JobsContext, str]:
    settings = _settings(tmp_path, **overrides)
    store = InMemoryJobStore(max_inflight=8)
    asyncio.run(store.create("job-1", hash_token("t"), "word-to-pdf"))
    ctx = JobsContext(
        settings=settings,
        store=store,
        engine=None,  # type: ignore[arg-type]
        jobs_root=tmp_path / "jobs",
        gate=None,  # type: ignore[arg-type]
        limiter=None,  # type: ignore[arg-type]
        client_salt=b"",
    )
    return ctx, "job-1"


def test_reading_stops_at_the_limit_instead_of_taking_the_whole_body(
    tmp_path: Path,
) -> None:
    ctx, job_id = _context(tmp_path, max_input_bytes=1024)
    request = _FakeRequest([b"x" * 400] * 1000)  # 400 KB offered, 1 KiB allowed
    target = tmp_path / "input.docx"

    async def run() -> None:
        with pytest.raises(ProcessorError) as caught:
            await _receive_input(ctx, job_id, request, target)  # type: ignore[arg-type]
        assert caught.value.code == ErrorCode.LIMIT_EXCEEDED

    asyncio.run(run())
    assert request.delivered <= 3  # 400 + 400 + 400 > 1024 on the third chunk
    assert target.stat().st_size <= 1024


def test_the_whole_accepted_body_is_written_and_counted(tmp_path: Path) -> None:
    ctx, job_id = _context(tmp_path, max_input_bytes=1024)
    request = _FakeRequest([b"a" * 100, b"", b"b" * 200])
    target = tmp_path / "input.docx"
    size = asyncio.run(_receive_input(ctx, job_id, request, target))  # type: ignore[arg-type]
    assert size == 300
    assert target.read_bytes() == b"a" * 100 + b"b" * 200


def test_each_chunk_counts_as_progress_for_the_janitor(tmp_path: Path) -> None:
    ctx, job_id = _context(tmp_path)
    job = ctx.store.get(job_id)
    assert job is not None
    job.updated_at = time.monotonic() - 100.0
    stale = job.updated_at
    request = _FakeRequest([b"a" * 10])
    asyncio.run(_receive_input(ctx, job_id, request, tmp_path / "input.docx"))  # type: ignore[arg-type]
    assert job.updated_at > stale + 50.0


def test_a_stalled_upload_is_cut_off(tmp_path: Path) -> None:
    ctx, job_id = _context(tmp_path)
    request = _FakeRequest([b"a" * 10], then_hang=True)
    target = tmp_path / "input.docx"

    async def run() -> None:
        with pytest.raises(ProcessorError) as caught:
            await _receive_input(
                ctx,
                job_id,
                request,  # type: ignore[arg-type]
                target,
                idle_seconds=0.05,
            )
        assert caught.value.code == ErrorCode.UPLOAD_STALLED

    asyncio.run(run())
    assert request.delivered == 1


def test_a_slow_but_steady_upload_is_not_cut_off(tmp_path: Path) -> None:
    """The idle period is time without a byte, not a deadline for the upload."""
    ctx, job_id = _context(tmp_path)
    request = _FakeRequest([b"a" * 10] * 6, delay=0.03)
    size = asyncio.run(
        _receive_input(
            ctx,
            job_id,
            request,  # type: ignore[arg-type]
            tmp_path / "input.docx",
            idle_seconds=0.1,
        )
    )
    assert size == 60


def test_a_job_deleted_mid_upload_stops_the_upload(tmp_path: Path) -> None:
    ctx, job_id = _context(tmp_path)
    ctx.store.discard(job_id)
    request = _FakeRequest([b"a" * 10, b"b" * 10])

    async def run() -> None:
        with pytest.raises(ProcessorError) as caught:
            await _receive_input(ctx, job_id, request, tmp_path / "input.docx")  # type: ignore[arg-type]
        assert caught.value.code == ErrorCode.INVALID_JOB

    asyncio.run(run())
    assert request.delivered == 1


# ── Jobs that never upload ───────────────────────────────────────────────


def _janitor(store: InMemoryJobStore, root: Path) -> Janitor:
    return Janitor(
        store,
        root,
        ".sentinel",
        job_lifetime_seconds=600.0,
        interval_seconds=60.0,
        created_idle_seconds=120.0,
    )


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "jobs"
    root.mkdir()
    (root / ".sentinel").write_text("ok")
    return root


def test_a_job_that_never_uploads_expires_after_the_short_idle_period(
    tmp_path: Path,
) -> None:
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    job = asyncio.run(store.create("idle", hash_token("t"), "word-to-pdf"))
    job.updated_at = time.monotonic() - 121.0
    _janitor(store, root).sweep()
    assert store.get("idle") is None


def test_a_created_job_inside_the_idle_period_is_kept(tmp_path: Path) -> None:
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    job = asyncio.run(store.create("fresh", hash_token("t"), "word-to-pdf"))
    job.updated_at = time.monotonic() - 119.0
    _janitor(store, root).sweep()
    assert store.get("fresh") is not None


def test_the_short_idle_period_does_not_apply_once_a_job_has_its_upload(
    tmp_path: Path,
) -> None:
    """An uploaded job may legitimately wait for the conversion slot, and its
    file is still covered by the full lifetime."""
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    job = asyncio.run(store.create("uploaded", hash_token("t"), "word-to-pdf"))
    asyncio.run(store.transition("uploaded", JobState.UPLOADING))
    job.updated_at = time.monotonic() - 300.0
    _janitor(store, root).sweep()
    assert store.get("uploaded") is not None
    job.updated_at = time.monotonic() - 601.0
    _janitor(store, root).sweep()
    assert store.get("uploaded") is None


# ── Response headers ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "request_fn",
    [
        lambda c: c.get("/health/live"),
        lambda c: c.post("/v1/jobs", json={"tool": "word-to-pdf"}),
        lambda c: c.post("/v1/jobs", json={"tool": "nope"}),
        lambda c: c.get("/v1/jobs/unknown", headers=_bearer("x")),
        lambda c: c.get("/does-not-exist"),
    ],
)
def test_every_response_carries_the_api_security_headers(
    tmp_path: Path, request_fn: Any
) -> None:
    with _client(tmp_path) as client:
        response = request_fn(client)
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"


def test_the_pdf_download_keeps_its_headers_and_type(tmp_path: Path) -> None:
    with _client(tmp_path, job_create_burst=50, max_input_bytes=1024 * 1024) as c:
        job_id, token = _create(c)
        c.put(
            f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=_minimal_docx()
        )
        assert (
            c.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token)).status_code
            == 200
        )
        output = c.get(f"/v1/jobs/{job_id}/output", headers=_bearer(token))
    assert output.status_code == 200
    assert output.headers["content-type"] == "application/pdf"
    assert output.headers["x-content-type-options"] == "nosniff"
    assert output.headers["cache-control"] == "no-store"
