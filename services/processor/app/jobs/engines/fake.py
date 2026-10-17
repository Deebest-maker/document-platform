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
        # Write a structurally valid minimal PDF so the full output
        # validation pipeline (header, qpdf --check, page count) passes
        # without needing real conversion.
        output_path.write_bytes(_MINIMAL_PDF)


# A single-page PDF with correct xref offsets that passes ``qpdf --check``.
_MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
    b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
    b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n"
    b"xref\n0 4\n"
    b"0000000000 65535 f \r\n"
    b"0000000009 00000 n \r\n"
    b"0000000058 00000 n \r\n"
    b"0000000115 00000 n \r\n"
    b"trailer\n<< /Size 4 /Root 1 0 R >>\n"
    b"startxref\n186\n%%EOF\n"
)
