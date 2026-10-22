"""In-memory job registry.

Single-process, single-worker storage. All state transitions, cancellation
and deletion go through `InMemoryJobStore`. The store is `asyncio`-safe:
every mutating operation takes the global lock, and per-job cancellation
events are held in a side table so a running job can observe cancellation
without racing the state transition.

Design rules:
    * The store NEVER accepts a job without a hashed capability token.
    * The store NEVER returns the raw token (there is nothing to return —
      only the hash lives here).
    * `.get()` on an unknown ID returns None; the API layer maps that to
      INVALID_JOB.
    * `.authorize()` is the single entry point for request authorization
      and does its own constant-time compare, so route handlers cannot
      accidentally return 401/404 in a timing-distinguishable way.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Iterator
from typing import Final

from app.errors import ErrorCode, ProcessorError
from app.jobs.auth import tokens_match
from app.jobs.state import (
    ACTIVE_STATES,
    TERMINAL_STATES,
    Job,
    JobState,
    assert_can_transition,
)


class InMemoryJobStore:
    def __init__(self, max_inflight: int) -> None:
        self._jobs: Final[dict[str, Job]] = {}
        self._cancel_events: Final[dict[str, asyncio.Event]] = {}
        self._lock = asyncio.Lock()
        self._max_inflight = max_inflight

    # ------------------------------------------------------------------
    # Introspection / enumeration
    # ------------------------------------------------------------------

    def __len__(self) -> int:
        return len(self._jobs)

    def iter_jobs(self) -> Iterator[Job]:
        """Snapshot iterator used by the janitor."""
        return iter(list(self._jobs.values()))

    # ------------------------------------------------------------------
    # Creation / lookup
    # ------------------------------------------------------------------

    async def create(
        self,
        job_id: str,
        token_hash: str,
        tool: str,
        *,
        client_key: str = "",
        max_active_per_client: int | None = None,
        retry_after: int = 30,
    ) -> Job:
        async with self._lock:
            active = [j for j in self._jobs.values() if j.state in ACTIVE_STATES]
            # The per-client cap is checked first so one caller who is over its
            # share is told so (429) rather than blamed on the service (503).
            if (
                client_key
                and max_active_per_client is not None
                and sum(1 for j in active if j.client_key == client_key)
                >= max_active_per_client
            ):
                raise ProcessorError(ErrorCode.RATE_LIMITED, retry_after=retry_after)
            if len(active) >= self._max_inflight:
                raise ProcessorError(ErrorCode.NOT_READY)
            if job_id in self._jobs:
                raise ProcessorError(ErrorCode.CONFLICT)
            now = time.monotonic()
            job = Job(
                id=job_id,
                token_hash=token_hash,
                tool=tool,
                state=JobState.CREATED,
                created_at=now,
                updated_at=now,
                client_key=client_key,
            )
            self._jobs[job_id] = job
            self._cancel_events[job_id] = asyncio.Event()
            return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def authorize(self, job_id: str, supplied_token: str | None) -> Job:
        """Resolve `job_id` and verify `supplied_token`.

        Raises INVALID_JOB if the ID is unknown, INVALID_TOKEN on any
        token mismatch (including missing supplied token). The two
        branches are intentionally separate so callers see the exact
        reason; timing differs by at most one dict access and one SHA-256,
        which is acceptable with 128-bit random IDs.
        """
        job = self._jobs.get(job_id)
        if job is None:
            raise ProcessorError(ErrorCode.INVALID_JOB)
        if not tokens_match(supplied_token or "", job.token_hash):
            raise ProcessorError(ErrorCode.INVALID_TOKEN)
        return job

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    async def transition(self, job_id: str, target: JobState) -> Job:
        async with self._lock:
            job = self._require(job_id)
            assert_can_transition(job.state, target)
            job.state = target
            job.updated_at = time.monotonic()
            return job

    def touch(self, job_id: str) -> bool:
        """Record progress on a job (an upload chunk arrived). False if gone.

        No await, so on the event loop it cannot interleave with another
        coroutine and does not need the lock.
        """
        job = self._jobs.get(job_id)
        if job is None:
            return False
        job.updated_at = time.monotonic()
        return True

    async def set_workspace(self, job_id: str, path: str) -> None:
        async with self._lock:
            job = self._require(job_id)
            job.workspace = path
            job.updated_at = time.monotonic()

    async def record_input_bytes(self, job_id: str, size: int) -> None:
        async with self._lock:
            job = self._require(job_id)
            job.input_bytes = size
            job.updated_at = time.monotonic()

    async def record_output_bytes(self, job_id: str, size: int) -> None:
        async with self._lock:
            job = self._require(job_id)
            job.output_bytes = size
            job.updated_at = time.monotonic()

    async def mark_failed(self, job_id: str, code: ErrorCode) -> None:
        async with self._lock:
            job = self._require(job_id)
            if job.state not in TERMINAL_STATES:
                job.state = JobState.FAILED
                job.error_code = code.value
                job.updated_at = time.monotonic()

    async def cancel(self, job_id: str) -> Job:
        async with self._lock:
            job = self._require(job_id)
            if job.state in TERMINAL_STATES:
                raise ProcessorError(ErrorCode.CONFLICT)
            job.state = JobState.CANCELLED
            job.updated_at = time.monotonic()
            event = self._cancel_events.get(job_id)
            if event is not None:
                event.set()
            return job

    def discard(self, job_id: str) -> None:
        """Drop a job synchronously (janitor expiry).

        Fires the cancel event so any engine still working on it stops. There
        is no await in here, so on the event loop it cannot interleave with
        another coroutine and does not need the lock.
        """
        self._jobs.pop(job_id, None)
        event = self._cancel_events.pop(job_id, None)
        if event is not None:
            event.set()

    async def delete(self, job_id: str) -> None:
        async with self._lock:
            self._jobs.pop(job_id, None)
            event = self._cancel_events.pop(job_id, None)
            if event is not None:
                event.set()

    # ------------------------------------------------------------------
    # Cancellation plumbing (used by the async runner)
    # ------------------------------------------------------------------

    def cancellation_event(self, job_id: str) -> asyncio.Event | None:
        return self._cancel_events.get(job_id)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _require(self, job_id: str) -> Job:
        job = self._jobs.get(job_id)
        if job is None:
            raise ProcessorError(ErrorCode.INVALID_JOB)
        return job
