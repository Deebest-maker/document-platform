"""FastAPI entrypoint for the processor control plane.

M4A wires:
    * /health/live (unchanged from M0) and /health/ready
    * /v1/jobs/* backed by an in-memory store + fake engine
    * jobs root validation + sentinel on startup
    * janitor lifecycle (start on startup, stop on shutdown)
    * dev-only CORS allowlist controlled by PROCESSOR_ENV + PROCESSOR_DEV_CORS_ORIGINS

Design: no new dependencies, no secrets in logs, no document bytes in logs,
no LibreOffice (M4B).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health as health_api
from app.api import jobs as jobs_api
from app.config import Settings, load_settings
from app.jobs.engines.fake import FakeEngine
from app.jobs.janitor import Janitor
from app.jobs.store import InMemoryJobStore
from app.jobs.workspace import validate_jobs_root
from app.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application.

    Factored out so tests can inject a per-test `Settings` (jobs_root in
    `tmp_path`, non-production environment) without touching the global
    `get_settings` cache.
    """
    configure_logging()
    settings = settings or load_settings()
    log = logging.getLogger("processor.main")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.processor = {"ready": False}
        try:
            jobs_root = validate_jobs_root(
                settings.jobs_root, settings.jobs_root_sentinel
            )
        except Exception:
            log.exception("jobs root validation failed")
            yield
            return
        store = InMemoryJobStore(max_inflight=settings.max_inflight_jobs)
        engine = FakeEngine()
        janitor = Janitor(
            store=store,
            jobs_root=jobs_root,
            sentinel=settings.jobs_root_sentinel,
            job_lifetime_seconds=settings.job_lifetime_seconds,
            interval_seconds=settings.janitor_interval_seconds,
        )
        app.state.jobs = jobs_api.JobsContext(
            settings=settings,
            store=store,
            engine=engine,
            jobs_root=jobs_root,
        )
        app.state.processor = {"ready": True, "janitor": janitor}
        await janitor.start()
        try:
            yield
        finally:
            await janitor.stop()
            app.state.processor = {"ready": False}

    app = FastAPI(
        title="Document Platform Processor",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    if settings.environment == "development" and settings.dev_cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.dev_cors_origins),
            allow_methods=["GET", "POST", "PUT", "DELETE"],
            allow_headers=["authorization", "content-type"],
            allow_credentials=False,
            max_age=600,
        )

    app.include_router(health_api.router)
    app.include_router(jobs_api.router)
    return app


# Default app used by uvicorn in production. Tests build their own via
# `create_app(settings=...)`.
app = create_app()
