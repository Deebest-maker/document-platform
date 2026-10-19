"""Conversion gate: exactly one on-disk conversion at a time.

Governance §9.3 sets "exactly one on-disk conversion at a time" as the M4
baseline (a security/data-separation invariant, and the M4D benchmark shows
why it also protects memory: each LibreOffice conversion adds roughly 220 MiB
RSS, so concurrent conversions grow linearly with the number of callers).

The gate is a single-slot semaphore with a bounded wait:

    * a caller waits at most ``wait_timeout_seconds`` for the slot, then gets
      ``ProcessorError(NOT_READY)`` (HTTP 503, "try again") instead of
      holding a connection open behind a long conversion;
    * at most ``max_waiting`` callers may wait at once; beyond that the
      caller is turned away immediately, so a flood of requests cannot pile
      up unbounded waiter state.

Unauthenticated callers must never reach the gate; the API authorises first.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from app.errors import ErrorCode, ProcessorError


class ConversionGate:
    """Single-slot gate with a bounded queue and a bounded wait."""

    def __init__(self, *, max_waiting: int, wait_timeout_seconds: float) -> None:
        self._slot = asyncio.Semaphore(1)
        self._max_waiting = max_waiting
        self._wait_timeout = wait_timeout_seconds
        self._waiting = 0

    @property
    def waiting(self) -> int:
        """Callers currently waiting for the slot (not the one holding it)."""
        return self._waiting

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        """Hold the conversion slot for the duration of the ``async with``."""
        if self._waiting >= self._max_waiting:
            raise ProcessorError(ErrorCode.NOT_READY)
        self._waiting += 1
        try:
            await asyncio.wait_for(self._slot.acquire(), timeout=self._wait_timeout)
        except TimeoutError:
            raise ProcessorError(ErrorCode.NOT_READY) from None
        finally:
            self._waiting -= 1
        try:
            yield
        finally:
            self._slot.release()
