"""Conversion gate: one conversion at a time, bounded wait, bounded queue."""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import ErrorCode, ProcessorError
from app.jobs.gate import ConversionGate

from .helpers import _bearer, _create, _minimal_docx

# ── Unit tests ──────────────────────────────────────────────────────────


async def test_slot_is_exclusive() -> None:
    gate = ConversionGate(max_waiting=8, wait_timeout_seconds=5)
    active = 0
    peak = 0

    async def worker() -> None:
        nonlocal active, peak
        async with gate.slot():
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1

    await asyncio.gather(*(worker() for _ in range(6)))
    assert peak == 1
    assert gate.waiting == 0


async def test_wait_times_out_with_not_ready() -> None:
    gate = ConversionGate(max_waiting=8, wait_timeout_seconds=0.05)
    holder_started = asyncio.Event()
    release = asyncio.Event()

    async def holder() -> None:
        async with gate.slot():
            holder_started.set()
            await release.wait()

    task = asyncio.create_task(holder())
    await holder_started.wait()
    with pytest.raises(ProcessorError) as caught:
        async with gate.slot():
            pytest.fail("slot must not be granted while it is held")
    assert caught.value.code is ErrorCode.NOT_READY
    assert gate.waiting == 0
    release.set()
    await task


async def test_queue_is_bounded() -> None:
    gate = ConversionGate(max_waiting=1, wait_timeout_seconds=5)
    holder_started = asyncio.Event()
    release = asyncio.Event()

    async def holder() -> None:
        async with gate.slot():
            holder_started.set()
            await release.wait()

    async def waiter() -> None:
        async with gate.slot():
            pass

    holding = asyncio.create_task(holder())
    await holder_started.wait()
    first_waiter = asyncio.create_task(waiter())
    await asyncio.sleep(0.01)
    assert gate.waiting == 1
    # The queue is full: the next caller is turned away immediately.
    with pytest.raises(ProcessorError) as caught:
        async with gate.slot():
            pytest.fail("slot must not be granted")
    assert caught.value.code is ErrorCode.NOT_READY
    release.set()
    await asyncio.gather(holding, first_waiter)


async def test_slot_is_released_when_the_body_raises() -> None:
    gate = ConversionGate(max_waiting=2, wait_timeout_seconds=1)
    with pytest.raises(RuntimeError):
        async with gate.slot():
            raise RuntimeError("boom")
    async with gate.slot():
        pass


# ── API-level tests ─────────────────────────────────────────────────────


class _TrackingEngine:
    """Records the peak number of conversions running at once."""

    name = "tracking"

    def __init__(self, delay: float) -> None:
        self._delay = delay
        self._lock = threading.Lock()
        self.active = 0
        self.peak = 0

    async def convert(
        self,
        *,
        workspace: Path,
        input_path: Path,
        output_path: Path,
        cancel_token: object,
    ) -> None:
        with self._lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            await asyncio.sleep(self._delay)
            from app.jobs.engines.fake import _MINIMAL_PDF

            output_path.write_bytes(_MINIMAL_PDF)
        finally:
            with self._lock:
                self.active -= 1


def _ready_job(client: TestClient) -> tuple[str, str]:
    job_id, token = _create(client)
    upload = client.put(
        f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=_minimal_docx()
    )
    assert upload.status_code == 200, upload.text
    return job_id, token


def test_api_runs_conversions_one_at_a_time(client: TestClient, app: FastAPI) -> None:
    engine = _TrackingEngine(delay=0.1)
    app.state.jobs.engine = engine
    jobs = [_ready_job(client) for _ in range(4)]
    statuses: list[int] = []

    def convert(job: tuple[str, str]) -> None:
        job_id, token = job
        response = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
        statuses.append(response.status_code)

    threads = [threading.Thread(target=convert, args=(job,)) for job in jobs]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(statuses) == [200, 200, 200, 200]
    assert engine.peak == 1


def test_api_returns_503_when_the_slot_stays_busy(
    client: TestClient, app: FastAPI
) -> None:
    app.state.jobs.engine = _TrackingEngine(delay=0.6)
    app.state.jobs.gate = ConversionGate(max_waiting=4, wait_timeout_seconds=0.05)
    first = _ready_job(client)
    second = _ready_job(client)
    outcome: dict[str, int] = {}

    def run_first() -> None:
        response = client.post(
            f"/v1/jobs/{first[0]}/convert", headers=_bearer(first[1])
        )
        outcome["first"] = response.status_code

    worker = threading.Thread(target=run_first)
    worker.start()
    time.sleep(0.2)  # let the first conversion take the slot

    busy = client.post(f"/v1/jobs/{second[0]}/convert", headers=_bearer(second[1]))
    assert busy.status_code == 503
    assert busy.json()["detail"]["code"] == "not_ready"
    # A turned-away job is untouched and can be retried later.
    state = client.get(f"/v1/jobs/{second[0]}", headers=_bearer(second[1])).json()
    assert state["state"] == "uploading"

    worker.join(timeout=30)
    assert outcome["first"] == 200
    retry = client.post(f"/v1/jobs/{second[0]}/convert", headers=_bearer(second[1]))
    assert retry.status_code == 200


def test_unauthorised_caller_never_reaches_the_gate(
    client: TestClient, app: FastAPI
) -> None:
    gate = ConversionGate(max_waiting=1, wait_timeout_seconds=0.05)
    app.state.jobs.gate = gate
    job_id, _token = _ready_job(client)
    response = client.post(
        f"/v1/jobs/{job_id}/convert", headers=_bearer("not-the-token")
    )
    assert response.status_code == 401
    assert gate.waiting == 0
