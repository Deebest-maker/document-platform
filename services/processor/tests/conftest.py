"""Shared pytest fixtures.

Every test that touches the FastAPI app receives a fresh `Settings` with
its own temporary jobs root. `get_settings()` is never read directly in
tests to keep the environment stable.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def processor_settings(tmp_path: Path) -> Settings:
    jobs_root = tmp_path / "jobs"
    jobs_root.mkdir()
    (jobs_root / ".sentinel").write_text("ok")
    return Settings(
        environment="test",
        jobs_root=jobs_root,
        jobs_root_sentinel=".sentinel",
        max_input_bytes=1024 * 1024,
        max_output_bytes=1024 * 1024,
        job_lifetime_seconds=3600,
        runner_timeout_seconds=5,
        janitor_interval_seconds=3600,
        max_inflight_jobs=8,
        dev_cors_origins=(),
    )


@pytest.fixture
def app(processor_settings: Settings) -> FastAPI:
    return create_app(settings=processor_settings)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
