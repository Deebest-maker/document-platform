import asyncio
from collections.abc import Coroutine
from typing import Any

import pytest

from app.errors import ErrorCode, ProcessorError
from app.jobs.auth import hash_token, new_token
from app.jobs.state import JobState
from app.jobs.store import InMemoryJobStore


def _store(max_inflight: int = 4) -> InMemoryJobStore:
    return InMemoryJobStore(max_inflight=max_inflight)


def _run[T](coro: Coroutine[Any, Any, T]) -> T:
    return asyncio.run(coro)


def test_create_and_authorize_round_trip() -> None:
    token = new_token()
    store = _store()
    job = _run(store.create("job-1", hash_token(token), "word-to-pdf"))
    assert job.state is JobState.CREATED
    assert job.input_bytes == 0
    resolved = store.authorize("job-1", token)
    assert resolved is job


def test_authorize_unknown_job_is_invalid_job() -> None:
    with pytest.raises(ProcessorError) as info:
        _store().authorize("nope", "token")
    assert info.value.code is ErrorCode.INVALID_JOB


def test_authorize_wrong_token_is_invalid_token() -> None:
    store = _store()
    _run(store.create("j", hash_token(new_token()), "word-to-pdf"))
    for supplied in ["", None, "wrong-token"]:
        with pytest.raises(ProcessorError) as info:
            store.authorize("j", supplied)
        assert info.value.code is ErrorCode.INVALID_TOKEN


def test_create_rejects_duplicate_id() -> None:
    store = _store()
    _run(store.create("same", hash_token("t"), "word-to-pdf"))
    with pytest.raises(ProcessorError) as info:
        _run(store.create("same", hash_token("t"), "word-to-pdf"))
    assert info.value.code is ErrorCode.CONFLICT


def test_create_rejects_when_max_inflight_reached() -> None:
    store = _store(max_inflight=2)
    _run(store.create("a", hash_token("ta"), "word-to-pdf"))
    _run(store.create("b", hash_token("tb"), "word-to-pdf"))
    with pytest.raises(ProcessorError) as info:
        _run(store.create("c", hash_token("tc"), "word-to-pdf"))
    assert info.value.code is ErrorCode.NOT_READY


def test_cancel_sets_state_and_fires_event() -> None:
    store = _store()
    _run(store.create("j", hash_token("t"), "word-to-pdf"))
    event = store.cancellation_event("j")
    assert event is not None
    assert event.is_set() is False
    _run(store.cancel("j"))
    assert event.is_set() is True
    assert store.get("j").state is JobState.CANCELLED  # type: ignore[union-attr]


def test_cancel_rejects_terminal_job() -> None:
    store = _store()
    _run(store.create("j", hash_token("t"), "word-to-pdf"))
    _run(store.cancel("j"))
    with pytest.raises(ProcessorError):
        _run(store.cancel("j"))


def test_delete_removes_and_fires_event() -> None:
    store = _store()
    _run(store.create("j", hash_token("t"), "word-to-pdf"))
    event = store.cancellation_event("j")
    assert event is not None
    _run(store.delete("j"))
    assert store.get("j") is None
    assert event.is_set() is True


def test_mark_failed_sets_safe_code_and_is_idempotent() -> None:
    store = _store()
    _run(store.create("j", hash_token("t"), "word-to-pdf"))
    _run(store.mark_failed("j", ErrorCode.INVALID_INPUT))
    job = store.get("j")
    assert job is not None
    assert job.state is JobState.FAILED
    assert job.error_code == "invalid_input"
    # Re-marking does nothing because the state is already terminal.
    _run(store.mark_failed("j", ErrorCode.LIMIT_EXCEEDED))
    assert store.get("j").error_code == "invalid_input"  # type: ignore[union-attr]


def test_transitions_use_the_shared_rules() -> None:
    store = _store()
    _run(store.create("j", hash_token("t"), "word-to-pdf"))
    _run(store.transition("j", JobState.UPLOADING))
    with pytest.raises(ProcessorError):
        _run(store.transition("j", JobState.PROCESSING))
    _run(store.transition("j", JobState.VALIDATING))
    _run(store.transition("j", JobState.PROCESSING))
    _run(store.transition("j", JobState.SUCCEEDED))
