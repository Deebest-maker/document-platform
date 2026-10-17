"""LibreOffice headless conversion engine.

Converts DOCX → PDF via ``soffice --headless``. Governance §10.2:

    * Fixed argv list — no shell, no interpolation.
    * Fresh isolated UserInstallation profile per job (inside workspace).
    * Scrubbed environment — only essential vars forwarded.
    * Child runs in its own process group via the shared async runner;
      cancellation/timeout kills the entire tree.
    * Never reads the user's original filename.

The engine assumes ``soffice`` is on ``PATH`` inside the container
(installed in the Dockerfile). On dev machines without LibreOffice,
the engine raises ``ProcessorError(INTERNAL)`` immediately.
"""

from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path

from app.errors import ErrorCode, ProcessorError
from app.jobs.runner import run_process

# Default timeout for a single conversion. Config may override.
_DEFAULT_TIMEOUT_SECONDS: float = 120.0

# Grace period for SIGTERM → SIGKILL escalation.
_SIGTERM_GRACE_SECONDS: float = 5.0

# Environment variables forwarded to the LibreOffice subprocess.
# Everything else is scrubbed.
_ALLOWED_ENV_KEYS: frozenset[str] = frozenset(
    {
        "PATH",
        "HOME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
    }
)


class LibreOfficeEngine:
    """``ConversionEngine`` backed by LibreOffice headless."""

    name = "libreoffice"

    def __init__(
        self,
        *,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        soffice_path: str | None = None,
    ) -> None:
        self._timeout = timeout_seconds
        self._soffice = soffice_path or shutil.which("soffice") or "soffice"

    async def convert(
        self,
        *,
        workspace: Path,
        input_path: Path,
        output_path: Path,
        cancel_token: object,
    ) -> None:
        """Run LibreOffice headless to convert ``input_path`` → PDF.

        ``output_path`` is the expected final location of the PDF
        (always ``word-to-pdf.pdf`` inside ``workspace``). LibreOffice
        writes its own output name (derived from the input stem), so
        this method renames it after conversion.
        """
        if not input_path.exists() or not input_path.is_file():
            raise ProcessorError(ErrorCode.INVALID_INPUT)
        if output_path.parent != workspace:
            raise ProcessorError(ErrorCode.INTERNAL)

        # Verify soffice is available
        if not shutil.which(self._soffice) and self._soffice == "soffice":
            raise ProcessorError(ErrorCode.INTERNAL)

        # ── Fresh, isolated user profile ────────────────────────────
        profile_dir = workspace / "_lo_profile"
        profile_dir.mkdir(mode=0o700, exist_ok=True)

        # ── Scrubbed environment ────────────────────────────────────
        env = {k: v for k, v in os.environ.items() if k in _ALLOWED_ENV_KEYS}
        env["HOME"] = str(workspace)
        env["TMPDIR"] = str(workspace)

        # ── Build argv ──────────────────────────────────────────────
        argv = [
            self._soffice,
            "--headless",
            "--norestore",
            "--nologo",
            "--nofirststartwizard",
            f"-env:UserInstallation=file://{profile_dir}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(workspace),
            str(input_path),
        ]

        # ── Cancel event ────────────────────────────────────────────
        cancel_event = (
            cancel_token if isinstance(cancel_token, asyncio.Event) else None
        )

        # ── Run ─────────────────────────────────────────────────────
        result = await run_process(
            argv,
            cwd=str(workspace),
            env=env,
            timeout_seconds=self._timeout,
            cancel_event=cancel_event,
            sigterm_grace_seconds=_SIGTERM_GRACE_SECONDS,
        )

        if result.returncode != 0:
            raise ProcessorError(ErrorCode.INTERNAL)

        # ── Rename output ───────────────────────────────────────────
        # LibreOffice names the output after the input stem.
        # input.docx → input.pdf
        lo_output = workspace / (input_path.stem + ".pdf")
        if not lo_output.exists():
            # Sometimes LO uses a slightly different name; scan for any .pdf
            pdfs = list(workspace.glob("*.pdf"))
            if len(pdfs) == 1:
                lo_output = pdfs[0]
            elif len(pdfs) == 0:
                raise ProcessorError(ErrorCode.INTERNAL)
            else:
                # Multiple PDFs — unexpected; take the newest
                lo_output = max(pdfs, key=lambda p: p.stat().st_mtime)

        if lo_output != output_path:
            lo_output.rename(output_path)

        # ── Cleanup profile ─────────────────────────────────────────
        try:
            shutil.rmtree(profile_dir, ignore_errors=True)
        except Exception:
            pass  # Best-effort; janitor cleans the workspace later anyway
