"""Background janitor.

Runs at a configured interval and expires every job (in any state) that has
had no state change for ``job_lifetime_seconds``: its workspace is removed and
its registry entry dropped. Also removes workspaces whose owning job no longer
exists in the registry (crash-leftover case). The janitor only touches direct
children of the validated jobs root and never follows symlinks.
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from app.jobs.state import JobState
from app.jobs.store import InMemoryJobStore
from app.jobs.workspace import direct_children, remove_workspace


class Janitor:
    def __init__(
        self,
        store: InMemoryJobStore,
        jobs_root: Path,
        sentinel: str,
        job_lifetime_seconds: float,
        interval_seconds: float,
        logger: logging.Logger | None = None,
        created_idle_seconds: float | None = None,
    ) -> None:
        self._store = store
        self._jobs_root = jobs_root
        self._sentinel = sentinel
        self._lifetime = job_lifetime_seconds
        # A job still in `created` (no upload bytes yet) expires sooner: it holds
        # an in-flight slot and nothing else. None keeps the single lifetime.
        self._created_idle = created_idle_seconds
        self._interval = interval_seconds
        self._log = logger or logging.getLogger("processor.janitor")
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="processor-janitor")

    async def stop(self) -> None:
        self._stop.set()
        task = self._task
        if task is not None:
            try:
                await asyncio.wait_for(task, timeout=5.0)
            except TimeoutError:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.sweep()
            except Exception:  # noqa: BLE001
                # Never let the janitor crash the service; log and keep going.
                self._log.exception("janitor sweep failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._interval)
            except TimeoutError:
                continue

    def sweep(self) -> int:
        """Expire old jobs and clean up orphans. Returns workspaces removed.

        A job expires once ``job_lifetime_seconds`` have passed since its last
        state change, whatever state it is in (a job that never received an
        upload byte, still ``created``, expires after ``created_idle_seconds``;
        upload progress counts as a change). That covers abandoned uploads
        (``created`` / ``uploading``), which the browser's own cleanup cannot
        guarantee, as well as finished jobs nobody downloaded. Expiry removes
        the workspace and drops the registry entry, which also frees the
        in-flight slot. ``Settings`` guarantees the lifetime is longer than
        any legitimate conversion, so a running job is never cut short.
        """
        now = time.monotonic()
        removed = 0
        for job in self._store.iter_jobs():
            limit = self._lifetime
            if self._created_idle is not None and job.state == JobState.CREATED:
                limit = min(limit, self._created_idle)
            if (now - job.updated_at) < limit:
                continue
            if remove_workspace(self._jobs_root, self._jobs_root / job.id):
                removed += 1
            self._store.discard(job.id)
        for child in direct_children(self._jobs_root):
            # Never touch the sentinel itself (direct_children filters it
            # because it is a file, but we double-check by name just in case).
            if child.name == self._sentinel:
                continue
            if self._store.get(child.name) is None:
                # Workspace with no owning job: crash leftover.
                if remove_workspace(self._jobs_root, child):
                    removed += 1
        return removed
