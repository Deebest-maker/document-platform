"""Safe error vocabulary for the processor control plane.

Every HTTP response the processor returns on a failure path uses one of these
machine-readable codes. Internal paths, stack traces, library exception
messages, filesystem errors and engine-specific errors must never reach the
HTTP body. The UI never sees `ValueError: ...` or `/jobs/abc123/input`; it
sees a `code` and a short, allowlisted `message`.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final


class ErrorCode(StrEnum):
    INVALID_JOB = "invalid_job"
    INVALID_TOKEN = "invalid_token"
    INVALID_INPUT = "invalid_input"
    LIMIT_EXCEEDED = "limit_exceeded"
    CANCELLED = "cancelled"
    CONFLICT = "conflict"
    NOT_READY = "not_ready"
    RATE_LIMITED = "rate_limited"
    UPLOAD_STALLED = "upload_stalled"
    INTERNAL = "internal"


# Allowlisted human-readable copy. Fixed strings only; never interpolate
# document bytes, filenames, tokens, job IDs or paths.
MESSAGES: Final[dict[ErrorCode, str]] = {
    ErrorCode.INVALID_JOB: "This job does not exist or has expired.",
    ErrorCode.INVALID_TOKEN: "This request is not authorized for this job.",
    ErrorCode.INVALID_INPUT: "The uploaded file could not be accepted.",
    ErrorCode.LIMIT_EXCEEDED: "The request exceeds a configured processing limit.",
    ErrorCode.CANCELLED: "The job was cancelled before it could complete.",
    ErrorCode.CONFLICT: "The job is not in a state that permits this operation.",
    ErrorCode.NOT_READY: "The service is not ready to accept new jobs.",
    ErrorCode.RATE_LIMITED: (
        "Too many conversions were started from this connection. "
        "Wait a moment and try again."
    ),
    ErrorCode.UPLOAD_STALLED: "The upload stopped arriving and was closed.",
    ErrorCode.INTERNAL: "The job could not be processed. Try again later.",
}


class ProcessorError(Exception):
    """Raised internally; mapped to an HTTP response by the API layer."""

    def __init__(self, code: ErrorCode, retry_after: int | None = None) -> None:
        super().__init__(code.value)
        self.code: Final[ErrorCode] = code
        # Whole seconds a client should wait before retrying (Retry-After).
        self.retry_after: Final[int | None] = retry_after

    @property
    def message(self) -> str:
        return MESSAGES[self.code]


# HTTP status mapping. 4xx are owner-fixable, 503 is server-side readiness,
# 500 is a last resort (ProcessorError.INTERNAL only); other 5xx are never
# emitted directly from this vocabulary.
STATUS: Final[dict[ErrorCode, int]] = {
    ErrorCode.INVALID_JOB: 404,
    ErrorCode.INVALID_TOKEN: 401,
    ErrorCode.INVALID_INPUT: 400,
    ErrorCode.LIMIT_EXCEEDED: 413,
    ErrorCode.CANCELLED: 409,
    ErrorCode.CONFLICT: 409,
    ErrorCode.NOT_READY: 503,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.UPLOAD_STALLED: 408,
    ErrorCode.INTERNAL: 500,
}
