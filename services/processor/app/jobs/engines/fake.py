"""Fake conversion engine used by M4A tests.

Writes a deterministic PDF-like byte sequence to `output_path`. Honours
cancellation via the provided event. Never spawns a subprocess, never
touches anything outside `workspace`.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from app.errors import ErrorCode, ProcessorError


class FakeEngine:
    """Minimal `ConversionEngine` for M4A tests."""

    name = "fake"

    def __init__(self, delay_seconds: float = 0.0) -> None:
        self._delay_seconds = delay_seconds

    async def convert(
        self,
        *,
        workspace: Path,
        input_path: Path,
        output_path: Path,
        cancel_token: object,
    ) -> None:
        if not input_path.exists() or not input_path.is_file():
            raise ProcessorError(ErrorCode.INVALID_INPUT)
        if output_path.parent != workspace:
            raise ProcessorError(ErrorCode.INTERNAL)
        if self._delay_seconds > 0:
            event = cancel_token if isinstance(cancel_token, asyncio.Event) else None
            if event is not None:
                try:
                    await asyncio.wait_for(event.wait(), timeout=self._delay_seconds)
                    raise ProcessorError(ErrorCode.CANCELLED)
                except TimeoutError:
                    # Cancellation never arrived; proceed with the "conversion".
                    pass
            else:
                await asyncio.sleep(self._delay_seconds)
        # Write a tiny but valid-looking PDF so output validators can
        # exercise their header check without needing real conversion.
        header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
        body = b"% fake-engine output\n%%EOF\n"
        output_path.write_bytes(header + body)
