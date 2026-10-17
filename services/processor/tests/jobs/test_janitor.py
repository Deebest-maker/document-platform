import asyncio
import time
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

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


def test_sweep_leaves_active_jobs_alone(tmp_path: Path) -> None:
    root = _root(tmp_path)
    store = InMemoryJobStore(max_inflight=4)
    _run(store.create("job-A", hash_token("t"), "word-to-pdf"))
    (root / "job-A").mkdir()
    janitor = Janitor(
        store, root, ".sentinel", job_lifetime_seconds=0.0, interval_seconds=60
    )
    assert janitor.sweep() == 0
    assert (root / "job-A").exists()


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
