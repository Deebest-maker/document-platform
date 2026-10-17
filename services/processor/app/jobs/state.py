"""Job state model and transition rules.

The state machine is intentionally small and strict:

    CREATED → UPLOADING → VALIDATING → PROCESSING → SUCCEEDED
    any non-terminal → FAILED
    any non-active → EXPIRED (by lifecycle/janitor)

Transitions outside this graph raise `ProcessorError(CONFLICT)`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final

from app.errors import ErrorCode, ProcessorError


class JobState(StrEnum):
    CREATED = "created"
    UPLOADING = "uploading"
    VALIDATING = "validating"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


# States in which the job is actively holding resources on disk / in memory.
ACTIVE_STATES: Final[frozenset[JobState]] = frozenset(
    {JobState.CREATED, JobState.UPLOADING, JobState.VALIDATING, JobState.PROCESSING}
)

# States from which the job cannot progress further on its own.
TERMINAL_STATES: Final[frozenset[JobState]] = frozenset(
    {JobState.SUCCEEDED, JobState.FAILED, JobState.EXPIRED, JobState.CANCELLED}
)

# Allowed forward transitions. Any transition not listed here is a bug or
# a client error and is rejected via ProcessorError(CONFLICT). FAILED,
# EXPIRED and CANCELLED are reachable from every non-terminal state.
_FORWARD: Final[dict[JobState, frozenset[JobState]]] = {
    JobState.CREATED: frozenset({JobState.UPLOADING}),
    JobState.UPLOADING: frozenset({JobState.VALIDATING}),
    JobState.VALIDATING: frozenset({JobState.PROCESSING}),
    JobState.PROCESSING: frozenset({JobState.SUCCEEDED}),
}


def assert_can_transition(current: JobState, target: JobState) -> None:
    """Raise ProcessorError(CONFLICT) if the transition is not allowed."""
    if target == current:
        raise ProcessorError(ErrorCode.CONFLICT)
    if target in TERMINAL_STATES and target != JobState.SUCCEEDED:
        # FAILED / EXPIRED / CANCELLED are reachable from every active state.
        if current in TERMINAL_STATES:
            raise ProcessorError(ErrorCode.CONFLICT)
        return
    allowed = _FORWARD.get(current, frozenset())
    if target not in allowed:
        raise ProcessorError(ErrorCode.CONFLICT)


@dataclass(slots=True)
class Job:
    """In-memory job record. Never contains the raw capability token — only
    its hash — and never contains the user's filename."""

    id: str
    token_hash: str
    tool: str
    state: JobState = JobState.CREATED
    created_at: float = 0.0
    updated_at: float = 0.0
    input_bytes: int = 0
    output_bytes: int = 0
    error_code: str | None = None
    # The disk directory for this job, or None if not materialised yet.
    workspace: str | None = None
    # Fields the API layer sets on failure (safe code only).
    _metadata: dict[str, str] = field(default_factory=dict)
