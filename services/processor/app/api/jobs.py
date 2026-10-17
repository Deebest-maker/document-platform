"""Job HTTP surface.

Endpoints (all under /v1/jobs):

    POST   /                     — create a job, return (id, token)
    PUT    /{id}/input           — upload the input bytes
    POST   /{id}/convert         — kick off VALIDATING → PROCESSING → SUCCEEDED
    GET    /{id}                 — current job state
    GET    /{id}/output          — authorized download of the result
    DELETE /{id}                 — cancel + delete (idempotent)

Every endpoint except the create route authorizes with
`Authorization: Bearer <token>`. The create route is anonymous; the
response body carries both the job id and the capability token. The
token is NEVER echoed back on any later request and never logged.

M4A ships a fake engine. The route handlers wire a `ConversionEngine`
and a `JobsContext` dependency; M4B will swap in LibreOffice without
touching this file.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Final, NoReturn

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.config import Settings
from app.errors import MESSAGES, STATUS, ErrorCode, ProcessorError
from app.jobs.auth import extract_bearer_token, issue
from app.jobs.engines.base import ConversionEngine
from app.jobs.state import Job, JobState
from app.jobs.store import InMemoryJobStore
from app.jobs.workspace import create_workspace, remove_workspace
from app.logging import safe_log

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])

_INPUT_FILENAME: Final[str] = "input.docx"
_OUTPUT_FILENAME: Final[str] = "word-to-pdf.pdf"


@dataclass(slots=True)
class JobsContext:
    """Everything the job routes need. Attached to `request.app.state`."""

    settings: Settings
    store: InMemoryJobStore
    engine: ConversionEngine
    jobs_root: Path


class CreateJobRequest(BaseModel):
    tool: str = Field(default="word-to-pdf")


class CreateJobResponse(BaseModel):
    id: str
    token: str
    state: str


class JobStateResponse(BaseModel):
    id: str
    tool: str
    state: str
    input_bytes: int
    output_bytes: int
    error_code: str | None


class ErrorResponse(BaseModel):
    code: str
    message: str


def _ctx(request: Request) -> JobsContext:
    ctx = getattr(request.app.state, "jobs", None)
    if not isinstance(ctx, JobsContext):
        raise HTTPException(
            status_code=STATUS[ErrorCode.NOT_READY],
            detail={
                "code": ErrorCode.NOT_READY.value,
                "message": MESSAGES[ErrorCode.NOT_READY],
            },
        )
    return ctx


def _raise(code: ErrorCode) -> NoReturn:
    raise HTTPException(
        status_code=STATUS[code],
        detail={"code": code.value, "message": MESSAGES[code]},
    )


def _authorize(ctx: JobsContext, job_id: str, authorization: str | None) -> Job:
    token = extract_bearer_token(authorization)
    return ctx.store.authorize(job_id, token)


@router.post("", response_model=CreateJobResponse, status_code=201)
async def create_job(payload: CreateJobRequest, request: Request) -> CreateJobResponse:
    ctx = _ctx(request)
    if payload.tool != "word-to-pdf":
        _raise(ErrorCode.INVALID_INPUT)
    credential = issue()
    try:
        await ctx.store.create(credential.job_id, credential.token_hash, payload.tool)
    except ProcessorError as err:
        _raise(err.code)
    safe_log(
        logging.getLogger("processor.jobs"),
        logging.INFO,
        "job_created",
        job_id=credential.job_id,
        tool=payload.tool,
        state=JobState.CREATED.value,
    )
    return CreateJobResponse(
        id=credential.job_id,
        token=credential.token,
        state=JobState.CREATED.value,
    )


@router.put("/{job_id}/input")
async def upload_input(
    job_id: str,
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    ctx = _ctx(request)
    try:
        job = _authorize(ctx, job_id, authorization)
    except ProcessorError as err:
        _raise(err.code)
    if job.state != JobState.CREATED:
        _raise(ErrorCode.CONFLICT)
    max_bytes = ctx.settings.max_input_bytes
    body = await request.body()
    size = len(body)
    if size == 0:
        _raise(ErrorCode.INVALID_INPUT)
    if size > max_bytes:
        _raise(ErrorCode.LIMIT_EXCEEDED)
    try:
        workspace = create_workspace(ctx.jobs_root, job_id)
    except Exception:  # noqa: BLE001
        await ctx.store.mark_failed(job_id, ErrorCode.INTERNAL)
        _raise(ErrorCode.INTERNAL)
    input_path = workspace / _INPUT_FILENAME
    input_path.write_bytes(body)
    await ctx.store.set_workspace(job_id, str(workspace))
    await ctx.store.record_input_bytes(job_id, size)
    await ctx.store.transition(job_id, JobState.UPLOADING)
    safe_log(
        logging.getLogger("processor.jobs"),
        logging.INFO,
        "input_uploaded",
        job_id=job_id,
        input_bytes=size,
        state=JobState.UPLOADING.value,
    )
    return {"status": "ok"}


@router.post("/{job_id}/convert")
async def convert(
    job_id: str,
    request: Request,
    authorization: str | None = Header(default=None),
) -> JobStateResponse:
    ctx = _ctx(request)
    try:
        job = _authorize(ctx, job_id, authorization)
    except ProcessorError as err:
        _raise(err.code)
    if job.state != JobState.UPLOADING or job.workspace is None:
        _raise(ErrorCode.CONFLICT)
    workspace = Path(job.workspace)
    input_path = workspace / _INPUT_FILENAME
    output_path = workspace / _OUTPUT_FILENAME

    await ctx.store.transition(job_id, JobState.VALIDATING)
    # M4A has no DOCX validator yet; the fake engine's `convert` is the
    # single step. M4B replaces this block with the real validator.
    try:
        await ctx.store.transition(job_id, JobState.PROCESSING)
        cancel_event = ctx.store.cancellation_event(job_id)
        await ctx.engine.convert(
            workspace=workspace,
            input_path=input_path,
            output_path=output_path,
            cancel_token=cancel_event,
        )
    except ProcessorError as err:
        await ctx.store.mark_failed(job_id, err.code)
        _raise(err.code)
    except Exception:  # noqa: BLE001
        await ctx.store.mark_failed(job_id, ErrorCode.INTERNAL)
        _raise(ErrorCode.INTERNAL)
    if not output_path.exists():
        await ctx.store.mark_failed(job_id, ErrorCode.INTERNAL)
        _raise(ErrorCode.INTERNAL)
    output_size = output_path.stat().st_size
    if output_size > ctx.settings.max_output_bytes:
        await ctx.store.mark_failed(job_id, ErrorCode.LIMIT_EXCEEDED)
        _raise(ErrorCode.LIMIT_EXCEEDED)
    await ctx.store.record_output_bytes(job_id, output_size)
    await ctx.store.transition(job_id, JobState.SUCCEEDED)
    safe_log(
        logging.getLogger("processor.jobs"),
        logging.INFO,
        "job_succeeded",
        job_id=job_id,
        output_bytes=output_size,
        engine=ctx.engine.name,
        state=JobState.SUCCEEDED.value,
    )
    return _state_payload(ctx, job_id)


@router.get("/{job_id}", response_model=JobStateResponse)
async def job_state(
    job_id: str,
    request: Request,
    authorization: str | None = Header(default=None),
) -> JobStateResponse:
    ctx = _ctx(request)
    try:
        _authorize(ctx, job_id, authorization)
    except ProcessorError as err:
        _raise(err.code)
    return _state_payload(ctx, job_id)


@router.get("/{job_id}/output")
async def download_output(
    job_id: str,
    request: Request,
    authorization: str | None = Header(default=None),
) -> Response:
    ctx = _ctx(request)
    try:
        job = _authorize(ctx, job_id, authorization)
    except ProcessorError as err:
        _raise(err.code)
    if job.state != JobState.SUCCEEDED or job.workspace is None:
        _raise(ErrorCode.CONFLICT)
    output_path = Path(job.workspace) / _OUTPUT_FILENAME
    if not output_path.exists():
        _raise(ErrorCode.INVALID_JOB)
    return FileResponse(
        path=str(output_path),
        media_type="application/pdf",
        filename=_OUTPUT_FILENAME,
        headers={"Cache-Control": "no-store"},
    )


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: str,
    request: Request,
    authorization: str | None = Header(default=None),
) -> Response:
    ctx = _ctx(request)
    try:
        job = _authorize(ctx, job_id, authorization)
    except ProcessorError as err:
        _raise(err.code)
    workspace = job.workspace
    try:
        await ctx.store.cancel(job_id)
    except ProcessorError:
        # Already terminal — fall through to cleanup.
        pass
    if workspace is not None:
        remove_workspace(ctx.jobs_root, Path(workspace))
    await ctx.store.delete(job_id)
    safe_log(
        logging.getLogger("processor.jobs"),
        logging.INFO,
        "job_deleted",
        job_id=job_id,
    )
    return Response(status_code=204)


def _state_payload(ctx: JobsContext, job_id: str) -> JobStateResponse:
    job = ctx.store.get(job_id)
    if job is None:
        _raise(ErrorCode.INVALID_JOB)
    assert job is not None  # for the type checker; _raise never returns
    return JobStateResponse(
        id=job.id,
        tool=job.tool,
        state=job.state.value,
        input_bytes=job.input_bytes,
        output_bytes=job.output_bytes,
        error_code=job.error_code,
    )
