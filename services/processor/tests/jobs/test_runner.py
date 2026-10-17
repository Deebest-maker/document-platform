import asyncio
import os
import sys
from collections.abc import Coroutine
from typing import Any

import pytest

from app.errors import ErrorCode, ProcessorError
from app.jobs.runner import run_process


def _run[T](coro: Coroutine[Any, Any, T]) -> T:
    return asyncio.run(coro)


def test_runner_captures_stdout_and_exit_code() -> None:
    result = _run(
        run_process(
            [sys.executable, "-c", "print('hello')"],
            cwd=os.getcwd(),
            env=os.environ,
            timeout_seconds=5,
        )
    )
    assert result.returncode == 0
    assert result.stdout.strip() == b"hello"


def test_runner_times_out_and_raises_limit_exceeded() -> None:
    with pytest.raises(ProcessorError) as info:
        _run(
            run_process(
                [sys.executable, "-c", "import time; time.sleep(5)"],
                cwd=os.getcwd(),
                env=os.environ,
                timeout_seconds=0.3,
            )
        )
    assert info.value.code is ErrorCode.LIMIT_EXCEEDED


def test_runner_cancels_on_event_and_kills_the_group() -> None:
    async def scenario() -> None:
        event = asyncio.Event()
        task = asyncio.create_task(
            run_process(
                [sys.executable, "-c", "import time; time.sleep(30)"],
                cwd=os.getcwd(),
                env=os.environ,
                timeout_seconds=30,
                cancel_event=event,
            )
        )
        await asyncio.sleep(0.1)
        event.set()
        with pytest.raises(ProcessorError) as info:
            await task
        assert info.value.code is ErrorCode.CANCELLED

    asyncio.run(scenario())


def test_runner_refuses_empty_argv() -> None:
    with pytest.raises(ProcessorError) as info:
        _run(
            run_process(
                [],
                cwd=os.getcwd(),
                env=os.environ,
                timeout_seconds=5,
            )
        )
    assert info.value.code is ErrorCode.INTERNAL
