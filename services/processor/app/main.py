"""M0 service boundary: process liveness only."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="Document Platform Processor",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


@app.get("/health/live", response_model=HealthResponse)
def liveness() -> HealthResponse:
    """Report liveness without exposing configuration or environment details."""
    return HealthResponse()
