"""Per-client request limiting.

A small token bucket per client key. In memory, single process, no dependency:
the processor runs as one worker (governance §9.3), so the table is the whole
truth. The table is bounded: past ``max_clients`` the entries that have fully
refilled are dropped first, then the least recently used.

The key is whatever the caller passes (see ``client.py``: a keyed hash of the
network address). The limiter never sees, stores or logs an address.
"""

from __future__ import annotations

import math
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(slots=True)
class _Bucket:
    tokens: float
    updated: float


class TokenBucketLimiter:
    """``burst`` tokens, refilled one per ``refill_seconds``."""

    def __init__(
        self,
        *,
        burst: int,
        refill_seconds: float,
        max_clients: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if burst < 1 or refill_seconds <= 0 or max_clients < 1:
            msg = "burst, refill_seconds and max_clients must be positive"
            raise ValueError(msg)
        self._burst = float(burst)
        self._refill = float(refill_seconds)
        self._max_clients = max_clients
        self._clock = clock
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()

    def __len__(self) -> int:
        return len(self._buckets)

    def try_acquire(self, key: str) -> int | None:
        """Take one token. Returns None if allowed, else whole seconds to wait."""
        now = self._clock()
        bucket = self._buckets.get(key)
        if bucket is None:
            self._make_room()
            bucket = _Bucket(tokens=self._burst, updated=now)
            self._buckets[key] = bucket
        else:
            elapsed = max(0.0, now - bucket.updated)
            bucket.tokens = min(self._burst, bucket.tokens + elapsed / self._refill)
            bucket.updated = now
            self._buckets.move_to_end(key)
        if bucket.tokens >= 1.0:
            bucket.tokens -= 1.0
            return None
        return max(1, math.ceil((1.0 - bucket.tokens) * self._refill))

    def _make_room(self) -> None:
        if len(self._buckets) < self._max_clients:
            return
        now = self._clock()
        # Entries that have refilled completely carry no information: drop them.
        full = [
            key
            for key, bucket in self._buckets.items()
            if bucket.tokens + (now - bucket.updated) / self._refill >= self._burst
        ]
        for key in full:
            del self._buckets[key]
        # Still full of active clients: forget the least recently used.
        while len(self._buckets) >= self._max_clients:
            self._buckets.popitem(last=False)
