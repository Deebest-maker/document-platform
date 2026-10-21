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
