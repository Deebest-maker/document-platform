"""A job that expires while its upload is still arriving must not leak bytes."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import ErrorCode, ProcessorError

from .helpers import _bearer, _create, _minimal_docx


def test_upload_after_expiry_returns_404_and_leaves_no_workspace(
    client: TestClient, app: FastAPI, tmp_path: Path
) -> None:
    job_id, token = _create(client)
    jobs_root: Path = app.state.jobs.jobs_root

    async def _expired(_job_id: str, _path: str) -> None:
        # The janitor dropped the job while the body was still being read.
        raise ProcessorError(ErrorCode.INVALID_JOB)

    app.state.jobs.store.set_workspace = _expired
    response = client.put(
        f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=_minimal_docx()
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "invalid_job"
    leftovers = [p.name for p in jobs_root.iterdir() if not p.name.startswith(".")]
    assert leftovers == []
