import pytest

from app.errors import ErrorCode, ProcessorError
from app.jobs.state import (
    ACTIVE_STATES,
    TERMINAL_STATES,
    JobState,
    assert_can_transition,
)


def test_active_and_terminal_sets_are_disjoint_and_cover_everything() -> None:
    assert ACTIVE_STATES.isdisjoint(TERMINAL_STATES)
    assert ACTIVE_STATES | TERMINAL_STATES == set(JobState)


def test_forward_transitions_follow_the_approved_graph() -> None:
    assert_can_transition(JobState.CREATED, JobState.UPLOADING)
    assert_can_transition(JobState.UPLOADING, JobState.VALIDATING)
    assert_can_transition(JobState.VALIDATING, JobState.PROCESSING)
    assert_can_transition(JobState.PROCESSING, JobState.SUCCEEDED)


def test_skipping_a_state_is_rejected() -> None:
    with pytest.raises(ProcessorError) as info:
        assert_can_transition(JobState.CREATED, JobState.PROCESSING)
    assert info.value.code is ErrorCode.CONFLICT


def test_backwards_transitions_are_rejected() -> None:
    with pytest.raises(ProcessorError):
        assert_can_transition(JobState.PROCESSING, JobState.UPLOADING)


def test_self_transitions_are_rejected() -> None:
    with pytest.raises(ProcessorError):
        assert_can_transition(JobState.PROCESSING, JobState.PROCESSING)


def test_cancellation_is_reachable_from_every_active_state() -> None:
    for state in ACTIVE_STATES:
        assert_can_transition(state, JobState.CANCELLED)
        assert_can_transition(state, JobState.FAILED)
        assert_can_transition(state, JobState.EXPIRED)


def test_cancellation_from_terminal_state_is_rejected() -> None:
    for state in TERMINAL_STATES:
        with pytest.raises(ProcessorError):
            assert_can_transition(state, JobState.CANCELLED)
