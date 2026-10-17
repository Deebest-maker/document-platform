"""Processor settings.

Env-driven. No new runtime dependency — read directly from `os.environ` and
validate with pydantic. Every default is safe for a clean dev checkout; CI
and production override via environment variables.

Design rules:
    * No secret is logged.
    * No path is interpolated from a user filename.
    * `jobs_root` must satisfy workspace.validate_jobs_root at startup;
      this module only parses, workspace enforces safety.
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Final

from pydantic import BaseModel, Field, field_validator

# Reasonable, measured-independent defaults for M4A. Numeric production
# values are determined by M4B/M4D benchmarks before any public rollout.
_DEFAULT_MAX_INPUT_BYTES: Final[int] = 20 * 1024 * 1024  # 20 MiB
_DEFAULT_MAX_OUTPUT_BYTES: Final[int] = 32 * 1024 * 1024  # 32 MiB
_DEFAULT_JOB_LIFETIME_SECONDS: Final[int] = 15 * 60  # 15 minutes
_DEFAULT_RUNNER_TIMEOUT_SECONDS: Final[int] = 120  # 2 minutes
_DEFAULT_JANITOR_INTERVAL_SECONDS: Final[int] = 60
_DEFAULT_MAX_INFLIGHT_JOBS: Final[int] = 32


class Settings(BaseModel):
    """Validated runtime settings.

    Instances are frozen so a running process cannot be reconfigured by
    accident. Construct via `load_settings()` which reads the environment.
    """

    model_config = {"frozen": True}

    environment: str = Field(default="production")
    """`development`, `production` or `test`. Controls dev-CORS allowlist."""

    jobs_root: Path
    """Path to the dedicated jobs root. The absolute-path and sentinel safety
    checks run at startup in `workspace.validate_jobs_root`; the Settings
    object only carries the configured value."""

    jobs_root_sentinel: str = Field(default=".document-platform-jobs-root")
    """Sentinel filename the jobs root must contain before the janitor acts."""

    max_input_bytes: int = Field(default=_DEFAULT_MAX_INPUT_BYTES, gt=0)
    max_output_bytes: int = Field(default=_DEFAULT_MAX_OUTPUT_BYTES, gt=0)
    job_lifetime_seconds: int = Field(default=_DEFAULT_JOB_LIFETIME_SECONDS, gt=0)
    runner_timeout_seconds: int = Field(default=_DEFAULT_RUNNER_TIMEOUT_SECONDS, gt=0)
    janitor_interval_seconds: int = Field(
        default=_DEFAULT_JANITOR_INTERVAL_SECONDS, gt=0
    )
    max_inflight_jobs: int = Field(default=_DEFAULT_MAX_INFLIGHT_JOBS, gt=0)

    dev_cors_origins: tuple[str, ...] = Field(default=())
    """Only honoured when `environment == "development"`."""

    @field_validator("dev_cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(part.strip() for part in value.split(",") if part.strip())
        return value


def _get_env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def _get_env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw) if raw else default


def load_settings() -> Settings:
    """Read the environment once and build a frozen Settings."""
    default_jobs_root = Path("/var/lib/document-platform-processor/jobs")
    return Settings(
        environment=os.environ.get("PROCESSOR_ENV", "production"),
        jobs_root=_get_env_path("PROCESSOR_JOBS_ROOT", default_jobs_root),
        jobs_root_sentinel=os.environ.get(
            "PROCESSOR_JOBS_SENTINEL", ".document-platform-jobs-root"
        ),
        max_input_bytes=_get_env_int(
            "PROCESSOR_MAX_INPUT_BYTES", _DEFAULT_MAX_INPUT_BYTES
        ),
        max_output_bytes=_get_env_int(
            "PROCESSOR_MAX_OUTPUT_BYTES", _DEFAULT_MAX_OUTPUT_BYTES
        ),
        job_lifetime_seconds=_get_env_int(
            "PROCESSOR_JOB_LIFETIME_SECONDS", _DEFAULT_JOB_LIFETIME_SECONDS
        ),
        runner_timeout_seconds=_get_env_int(
            "PROCESSOR_RUNNER_TIMEOUT_SECONDS", _DEFAULT_RUNNER_TIMEOUT_SECONDS
        ),
        janitor_interval_seconds=_get_env_int(
            "PROCESSOR_JANITOR_INTERVAL_SECONDS",
            _DEFAULT_JANITOR_INTERVAL_SECONDS,
        ),
        max_inflight_jobs=_get_env_int(
            "PROCESSOR_MAX_INFLIGHT_JOBS", _DEFAULT_MAX_INFLIGHT_JOBS
        ),
        dev_cors_origins=os.environ.get("PROCESSOR_DEV_CORS_ORIGINS", ""),  # type: ignore[arg-type]
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor. Tests clear the cache via `get_settings.cache_clear()`."""
    return load_settings()
