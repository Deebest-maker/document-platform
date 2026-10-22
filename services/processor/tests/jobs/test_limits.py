"""Token-bucket limiter (M7B, ADR-033)."""

from __future__ import annotations

import pytest

from app.jobs.limits import TokenBucketLimiter


class _Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def _limiter(clock: _Clock, **overrides: int) -> TokenBucketLimiter:
    settings = {"burst": 3, "refill_seconds": 10, "max_clients": 100}
    settings.update(overrides)
    return TokenBucketLimiter(clock=clock, **settings)


def test_allows_the_burst_then_refuses_with_a_wait() -> None:
    clock = _Clock()
    limiter = _limiter(clock)
    assert [limiter.try_acquire("a") for _ in range(3)] == [None, None, None]
    wait = limiter.try_acquire("a")
    assert wait == 10  # a whole token is 10 s away


def test_one_token_comes_back_every_refill_period() -> None:
    clock = _Clock()
    limiter = _limiter(clock)
    for _ in range(3):
        limiter.try_acquire("a")
    clock.now += 9.0
    assert limiter.try_acquire("a") == 1  # 1 s short
    clock.now += 1.0
    assert limiter.try_acquire("a") is None
    assert limiter.try_acquire("a") is not None  # only one came back


def test_the_bucket_never_holds_more_than_the_burst() -> None:
    clock = _Clock()
    limiter = _limiter(clock)
    limiter.try_acquire("a")
    clock.now += 10_000.0
    assert [limiter.try_acquire("a") for _ in range(3)] == [None, None, None]
    assert limiter.try_acquire("a") is not None


def test_clients_have_separate_budgets() -> None:
    clock = _Clock()
    limiter = _limiter(clock)
    for _ in range(3):
        limiter.try_acquire("a")
    assert limiter.try_acquire("a") is not None
    assert limiter.try_acquire("b") is None


def test_the_wait_is_never_zero() -> None:
    clock = _Clock()
    limiter = _limiter(clock, burst=1, refill_seconds=1)
    limiter.try_acquire("a")
    clock.now += 0.999
    wait = limiter.try_acquire("a")
    assert wait is not None
    assert wait >= 1


def test_the_table_is_bounded_and_forgets_the_least_recent_first() -> None:
    clock = _Clock()
    limiter = _limiter(clock, max_clients=5)
    for index in range(50):
        limiter.try_acquire(f"client-{index}")
        clock.now += 0.01
    assert len(limiter) <= 5
    # The newest client is still remembered: it spent one token in the loop,
    # so it has two left, not a fresh three.
    assert limiter.try_acquire("client-49") is None
    assert limiter.try_acquire("client-49") is None
    assert limiter.try_acquire("client-49") is not None


def test_fully_refilled_clients_are_dropped_before_active_ones() -> None:
    clock = _Clock()
    limiter = _limiter(clock, max_clients=3)
    limiter.try_acquire("idle-1")
    limiter.try_acquire("idle-2")
    for _ in range(3):
        limiter.try_acquire("busy")
    clock.now += 1_000.0  # the idle ones are full again, "busy" too
    limiter.try_acquire("busy")
    limiter.try_acquire("busy")
    limiter.try_acquire("busy")  # busy is empty now
    limiter.try_acquire("new")  # table full: idle entries go, busy stays
    assert limiter.try_acquire("busy") is not None


@pytest.mark.parametrize(
    ("burst", "refill_seconds", "max_clients"),
    [(0, 1, 1), (1, 0, 1), (1, 1, 0)],
)
def test_rejects_nonsense_settings(
    burst: int, refill_seconds: int, max_clients: int
) -> None:
    with pytest.raises(ValueError, match="positive"):
        TokenBucketLimiter(
            burst=burst, refill_seconds=refill_seconds, max_clients=max_clients
        )
