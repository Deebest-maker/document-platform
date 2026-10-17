"""Liveness and readiness probes.

/health/live is a cheap process-liveness check that never touches the
disk. /health/ready returns `ok` only when the jobs root is validated
and the janitor is running; otherwise it returns 503 with the
NOT_READY code so Kubernetes-style readiness gates behave correctly.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.errors import MESSAGES, STATUS, ErrorCode


class LiveResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadyResponse(BaseModel):
    status: Literal["ok"] = "ok"


router = APIRouter(tags=["health"])


@router.get("/health/live", response_model=LiveResponse)
def liveness() -> LiveResponse:
    """Report liveness without exposing configuration or environment details."""
    return LiveResponse()


@router.get("/health/ready")
def readiness(request: Request, response: Response) -> dict[str, str]:
    """Report readiness. The processor is ready when the jobs root is
    valid and the janitor is running."""
    state = getattr(request.app.state, "processor", None)
    ready = bool(state and state.get("ready"))
    if not ready:
        response.status_code = STATUS[ErrorCode.NOT_READY]
        return {
            "status": "not_ready",
            "code": ErrorCode.NOT_READY.value,
            "message": MESSAGES[ErrorCode.NOT_READY],
        }
    return {"status": "ok"}
