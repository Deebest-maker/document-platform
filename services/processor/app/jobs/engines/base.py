"""Conversion-engine adapter interface.

An engine is a callable that takes a validated input file inside a job's
isolated workspace and produces an output file at a given path. It MUST:

    * run its subprocess (if any) through the shared async runner so
      cancellation and process-tree termination are consistent;
    * never read or write anywhere outside `workspace`;
    * never log raw filenames, document bytes, or extracted content;
    * raise `ProcessorError` with a safe code on failure.

M4A only ships `FakeEngine`. M4B will add `LibreOfficeEngine`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class ConversionEngine(Protocol):
    """Minimal engine protocol."""

    name: str

    async def convert(
        self,
        *,
        workspace: Path,
        input_path: Path,
        output_path: Path,
        cancel_token: object,
    ) -> None: ...
