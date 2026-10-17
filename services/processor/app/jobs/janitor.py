"""Background janitor.

Walks the validated jobs root at a configured interval and removes
workspaces whose job is already terminal + older than the retention
cutoff. Also removes workspaces whose owning job no longer exists in
the registry at all (crash-leftover case). The janitor only touches
direct children of the validated jobs root and never follows symlinks.
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from app.jobs.state import TERMINAL_STATES
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
    ) -> None:
        self._store = store
        self._jobs_root = jobs_root
        self._sentinel = sentinel
        self._lifetime = job_lifetime_seconds
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
        """Remove eligible workspaces. Returns the count removed."""
        now = time.monotonic()
        known_ids = {job.id for job in self._store.iter_jobs()}
        removed = 0
        for child in direct_children(self._jobs_root):
            # Never touch the sentinel itself (direct_children filters it
            # because it is a file, but we double-check by name just in case).
            if child.name == self._sentinel:
                continue
            job = self._store.get(child.name)
            if job is None and child.name not in known_ids:
                # Workspace with no owning job — treat as crash leftover.
                if remove_workspace(self._jobs_root, child):
                    removed += 1
                continue
            if job is None:
                continue
            if job.state in TERMINAL_STATES:
                if (now - job.updated_at) >= self._lifetime:
                    if remove_workspace(self._jobs_root, child):
                        removed += 1
        return removed
