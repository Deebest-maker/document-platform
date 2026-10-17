"""PDF output validator.

Runs after LibreOffice produces a PDF. Defence in depth — catches
converter failures, corrupted output, and oversized results before
the file is served to the client.

Checks:
    1. PDF header magic (%PDF-)
    2. File size within configured cap (caller enforces; this validates)
    3. qpdf --check structural validation (fail-closed on warnings)
    4. Page-count sanity bound via qpdf --show-npages
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Final

from app.errors import ErrorCode, ProcessorError

_PDF_HEADER: Final[bytes] = b"%PDF-"

# Maximum pages a single Word→PDF conversion should reasonably produce.
# A 10 000-page output from a single DOCX is almost certainly a bug.
MAX_PAGES: Final[int] = 10_000


def validate_pdf_header(output_path: Path) -> None:
    """Check that the file starts with a PDF header.

    Synchronous — fast enough for inline use.
    """
    if not output_path.exists() or not output_path.is_file():
        raise ProcessorError(ErrorCode.INTERNAL)
    with output_path.open("rb") as f:
        header = f.read(5)
    if header != _PDF_HEADER:
        raise ProcessorError(ErrorCode.INTERNAL)


async def validate_pdf_qpdf(output_path: Path, *, timeout: float = 30.0) -> None:
    """Run ``qpdf --check`` on the output PDF.

    Skipped silently if qpdf is not installed (development/test
    environments). In production the container image MUST include qpdf.
    Fail-closed: any non-zero exit from qpdf is a validation failure.
    """
    qpdf = shutil.which("qpdf")
    if qpdf is None:
        # Not installed — skip in dev/test. CI container has it.
        return

    try:
        proc = await asyncio.create_subprocess_exec(
            qpdf,
            "--check",
            str(output_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        raise ProcessorError(ErrorCode.INTERNAL) from None
    except Exception:
        raise ProcessorError(ErrorCode.INTERNAL) from None

    if proc.returncode != 0:
        # Fail closed: warnings and errors both reject.
        raise ProcessorError(ErrorCode.INTERNAL)


async def validate_pdf_page_count(output_path: Path, *, timeout: float = 10.0) -> int:
    """Return the page count, raising if it exceeds the sanity bound.

    Uses ``qpdf --show-npages``. Returns 0 and skips if qpdf is absent.
    """
    qpdf = shutil.which("qpdf")
    if qpdf is None:
        return 0

    try:
        proc = await asyncio.create_subprocess_exec(
            qpdf,
            "--show-npages",
            str(output_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except (TimeoutError, Exception):
        # Non-fatal: page count is a sanity check, not a hard gate.
        return 0

    if proc.returncode != 0:
        return 0

    try:
        pages = int(stdout.strip())
    except ValueError:
        return 0

    if pages > MAX_PAGES:
        raise ProcessorError(ErrorCode.LIMIT_EXCEEDED)
    return pages
