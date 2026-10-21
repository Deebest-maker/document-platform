import asyncio
import time
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

import pytest

from app.errors import ErrorCode, ProcessorError
from app.jobs.auth import hash_token
from app.jobs.janitor import Janitor
from app.jobs.state import JobState
from app.jobs.store import InMemoryJobStore


def _run[T](coro: Coroutine[Any, Any, T]) -> T:
    return asyncio.run(coro)


def _root(tmp_path: Path, sentinel: str = ".sentinel") -> Path:
    root = tmp_path / "jobs"
    root.mkdir()
    (root / sentinel).write_text("ok")
    return root


def test_sweep_removes_terminal_jobs_past_their_lifetime(tmp_path: Path) -> None:
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    job = _run(store.create("job-A", hash_token("t"), "word-to-pdf"))
    (root / "job-A").mkdir()
    _run(store.transition("job-A", JobState.UPLOADING))
    _run(store.transition("job-A", JobState.VALIDATING))
    _run(store.transition("job-A", JobState.PROCESSING))
    _run(store.transition("job-A", JobState.SUCCEEDED))
    # Pretend the job became terminal 2 seconds ago.
    job.updated_at = time.monotonic() - 2.0
    janitor = Janitor(
        store, root, ".sentinel", job_lifetime_seconds=1.0, interval_seconds=60
    )
    assert janitor.sweep() == 1
    assert not (root / "job-A").exists()


def test_sweep_leaves_young_active_jobs_alone(tmp_path: Path) -> None:
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    _run(store.create("job-A", hash_token("t"), "word-to-pdf"))
    (root / "job-A").mkdir()
    janitor = Janitor(
        store, root, ".sentinel", job_lifetime_seconds=60.0, interval_seconds=60
    )
    assert janitor.sweep() == 0
    assert (root / "job-A").exists()
    assert store.get("job-A") is not None


def test_sweep_expires_an_abandoned_upload_in_any_active_state(
    tmp_path: Path,
) -> None:
    """A job nobody finished must not live (or hold bytes) forever."""
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    stuck = _run(store.create("job-created", hash_token("a"), "word-to-pdf"))
    uploaded = _run(store.create("job-uploaded", hash_token("b"), "word-to-pdf"))
    (root / "job-uploaded").mkdir()
    (root / "job-uploaded" / "input.docx").write_bytes(b"private bytes")
    _run(store.transition("job-uploaded", JobState.UPLOADING))
    for job in (stuck, uploaded):
        job.updated_at = time.monotonic() - 2.0
    janitor = Janitor(
        store, root, ".sentinel", job_lifetime_seconds=1.0, interval_seconds=60
    )
    # Only the uploaded job had a workspace on disk to remove.
    assert janitor.sweep() == 1
    assert not (root / "job-uploaded").exists()
    assert store.get("job-created") is None
    assert store.get("job-uploaded") is None


def test_sweep_fires_the_cancel_event_of_an_expired_job(tmp_path: Path) -> None:
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    job = _run(store.create("job-A", hash_token("t"), "word-to-pdf"))
    event = store.cancellation_event("job-A")
    assert event is not None
    job.updated_at = time.monotonic() - 2.0
    Janitor(
        store, root, ".sentinel", job_lifetime_seconds=1.0, interval_seconds=60
    ).sweep()
    assert event.is_set()


def test_abandoned_jobs_cannot_lock_creation_forever(tmp_path: Path) -> None:
    """Regression (M4D): active jobs counted against the in-flight cap and were
    never expired, so N abandoned uploads blocked every new job until restart."""
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=3)
    jobs = [
        _run(store.create(f"job-{i}", hash_token(str(i)), "word-to-pdf"))
        for i in range(3)
    ]
    with pytest.raises(ProcessorError) as caught:
        _run(store.create("job-extra", hash_token("x"), "word-to-pdf"))
    assert caught.value.code is ErrorCode.NOT_READY
    for job in jobs:
        job.updated_at = time.monotonic() - 2.0
    Janitor(
        store, root, ".sentinel", job_lifetime_seconds=1.0, interval_seconds=60
    ).sweep()
    _run(store.create("job-extra", hash_token("x"), "word-to-pdf"))
    assert store.get("job-extra") is not None


def test_sweep_removes_orphan_workspace(tmp_path: Path) -> None:
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    (root / "crash-leftover").mkdir()
    janitor = Janitor(
        store, root, ".sentinel", job_lifetime_seconds=0.0, interval_seconds=60
    )
    assert janitor.sweep() == 1
    assert not (root / "crash-leftover").exists()


def test_sweep_never_removes_the_sentinel(tmp_path: Path) -> None:
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    janitor = Janitor(
        store, root, ".sentinel", job_lifetime_seconds=0.0, interval_seconds=60
    )
    janitor.sweep()
    assert (root / ".sentinel").exists()
