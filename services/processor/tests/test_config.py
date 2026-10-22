"""Settings validation."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings


def _settings(**overrides: object) -> Settings:
    return Settings(jobs_root=Path("/tmp/jobs"), **overrides)  # type: ignore[arg-type]


def test_defaults_are_internally_consistent() -> None:
    settings = _settings()
    busy = settings.runner_timeout_seconds + settings.convert_queue_wait_seconds
    assert settings.job_lifetime_seconds > busy


def test_lifetime_must_outlast_a_conversion() -> None:
    """The janitor expires jobs by age in any state, so a lifetime shorter than
    a conversion could delete a job while it is still being converted."""
    with pytest.raises(ValidationError, match="job_lifetime_seconds"):
        _settings(
            job_lifetime_seconds=140,
            runner_timeout_seconds=120,
            convert_queue_wait_seconds=20,
        )


def test_lifetime_just_above_the_conversion_window_is_accepted() -> None:
    settings = _settings(
        job_lifetime_seconds=141,
        runner_timeout_seconds=120,
        convert_queue_wait_seconds=20,
    )
    assert settings.job_lifetime_seconds == 141


def test_default_retention_is_ten_minutes_with_a_one_minute_sweep() -> None:
    """These two defaults are what the public privacy wording says (ADR-032).
    apps/web/lib/retention.ts must change together with them."""
    settings = _settings()
    assert settings.job_lifetime_seconds == 10 * 60
    assert settings.janitor_interval_seconds == 60


def test_abuse_control_defaults_are_pinned() -> None:
    """These are the numbers ADR-033 gives to the public. Change them together."""
    settings = _settings()
    assert settings.job_create_burst == 6
    assert settings.job_create_refill_seconds == 10
    assert settings.max_active_jobs_per_client == 3
    assert settings.created_job_idle_seconds == 120
    assert settings.trusted_proxy_hops == 0


def test_a_never_uploaded_job_must_expire_before_the_full_lifetime() -> None:
    with pytest.raises(ValidationError, match="created_job_idle_seconds"):
        _settings(job_lifetime_seconds=600, created_job_idle_seconds=600)


def test_the_idle_period_cannot_be_set_so_short_that_a_real_upload_trips_it() -> None:
    with pytest.raises(ValidationError):
        _settings(created_job_idle_seconds=5)


@pytest.mark.parametrize(
    "overrides",
    [
        {"job_create_burst": 0},
        {"job_create_refill_seconds": 0},
        {"max_active_jobs_per_client": 0},
        {"rate_limit_max_clients": 10},
        {"trusted_proxy_hops": -1},
        {"trusted_proxy_hops": 9},
    ],
)
def test_abuse_control_settings_reject_nonsense(overrides: dict[str, int]) -> None:
    with pytest.raises(ValidationError):
        _settings(**overrides)
