import asyncio
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

import pytest

from app.errors import ErrorCode, ProcessorError
from app.jobs.engines.fake import FakeEngine


def _run[T](coro: Coroutine[Any, Any, T]) -> T:
    return asyncio.run(coro)


def test_fake_engine_writes_a_pdf_header(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    input_path = workspace / "input.docx"
    input_path.write_bytes(b"PK fake docx")
    output_path = workspace / "output.pdf"
    engine = FakeEngine()
    _run(
        engine.convert(
            workspace=workspace,
            input_path=input_path,
            output_path=output_path,
            cancel_token=None,
        )
    )
    data = output_path.read_bytes()
    assert data.startswith(b"%PDF-")
    assert data.endswith(b"%%EOF\n")


def test_fake_engine_rejects_missing_input(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    engine = FakeEngine()
    with pytest.raises(ProcessorError) as info:
        _run(
            engine.convert(
                workspace=workspace,
                input_path=workspace / "missing.docx",
                output_path=workspace / "output.pdf",
                cancel_token=None,
            )
        )
    assert info.value.code is ErrorCode.INVALID_INPUT


def test_fake_engine_refuses_output_outside_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    other = tmp_path / "other"
    other.mkdir()
    input_path = workspace / "input.docx"
    input_path.write_bytes(b"PK")
    engine = FakeEngine()
    with pytest.raises(ProcessorError) as info:
        _run(
            engine.convert(
                workspace=workspace,
                input_path=input_path,
                output_path=other / "output.pdf",
                cancel_token=None,
            )
        )
    assert info.value.code is ErrorCode.INTERNAL


def test_fake_engine_honours_cancellation(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    input_path = workspace / "input.docx"
    input_path.write_bytes(b"PK")

    async def scenario() -> None:
        event = asyncio.Event()
        engine = FakeEngine(delay_seconds=5)
        task = asyncio.create_task(
            engine.convert(
                workspace=workspace,
                input_path=input_path,
                output_path=workspace / "output.pdf",
                cancel_token=event,
            )
        )
        await asyncio.sleep(0.05)
        event.set()
        with pytest.raises(ProcessorError) as info:
            await task
        assert info.value.code is ErrorCode.CANCELLED

    asyncio.run(scenario())
