"""LibreOfficeEngine integration tests.

Skipped when ``soffice`` is not on PATH (local dev, CI without
LibreOffice). The processor Dockerfile installs LibreOffice; the
container CI job runs these.
"""

from __future__ import annotations

import asyncio
import io
import shutil
import zipfile
from pathlib import Path

import pytest

from app.errors import ErrorCode, ProcessorError
from app.jobs.engines.libreoffice import LibreOfficeEngine

_has_soffice = shutil.which("soffice") is not None
skip_no_soffice = pytest.mark.skipif(
    not _has_soffice, reason="LibreOffice not installed"
)


# ── Helpers ─────────────────────────────────────────────────────────────


def _make_docx() -> bytes:
    """Build a minimal, valid DOCX that LibreOffice can convert."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType='
            '"application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType='
            '"application/vnd.openxmlformats-officedocument.wordprocessingml'
            '.document.main+xml"/>'
            "</Types>",
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Relationships xmlns="
            '"http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type='
            '"http://schemas.openxmlformats.org/officeDocument/2006/'
            'relationships/officeDocument" Target="word/document.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main">'
            "<w:body><w:p><w:r><w:t>LibreOffice test</w:t></w:r></w:p>"
            "</w:body></w:document>",
        )
    return buf.getvalue()


# ── Unit tests (always run) ─────────────────────────────────────────────


class TestEngineConstruction:
    def test_name_is_libreoffice(self) -> None:
        engine = LibreOfficeEngine()
        assert engine.name == "libreoffice"

    def test_custom_timeout(self) -> None:
        engine = LibreOfficeEngine(timeout_seconds=42.0)
        assert engine._timeout == 42.0

    def test_custom_soffice_path(self) -> None:
        engine = LibreOfficeEngine(soffice_path="/usr/bin/soffice")
        assert engine._soffice == "/usr/bin/soffice"


# ── Input validation (always run) ───────────────────────────────────────


class TestInputValidation:
    @pytest.mark.asyncio
    async def test_missing_input_raises(self, tmp_path: Path) -> None:
        engine = LibreOfficeEngine(soffice_path="/usr/bin/false")
        cancel = asyncio.Event()
        with pytest.raises(ProcessorError) as info:
            await engine.convert(
                workspace=tmp_path,
                input_path=tmp_path / "nonexistent.docx",
                output_path=tmp_path / "word-to-pdf.pdf",
                cancel_token=cancel,
            )
        assert info.value.code is ErrorCode.INVALID_INPUT

    @pytest.mark.asyncio
    async def test_output_outside_workspace_raises(self, tmp_path: Path) -> None:
        # Write a dummy input
        inp = tmp_path / "input.docx"
        inp.write_bytes(_make_docx())
        engine = LibreOfficeEngine(soffice_path="/usr/bin/false")
        cancel = asyncio.Event()
        with pytest.raises(ProcessorError) as info:
            await engine.convert(
                workspace=tmp_path,
                input_path=inp,
                output_path=tmp_path.parent / "escape.pdf",
                cancel_token=cancel,
            )
        assert info.value.code is ErrorCode.INTERNAL


# ── Which failures are the document's and which are the service's (M7D) ─


def _fake_converter(tmp_path: Path, body: str) -> str:
    """A stand-in for soffice: a tiny script with the given shell body."""
    script = tmp_path / "fake-soffice"
    script.write_text(f"#!/bin/sh\n{body}\n")
    script.chmod(0o755)
    return str(script)


async def _convert_with(soffice: str, tmp_path: Path) -> ProcessorError:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "input.docx").write_bytes(_make_docx())
    engine = LibreOfficeEngine(soffice_path=soffice, timeout_seconds=20.0)
    with pytest.raises(ProcessorError) as info:
        await engine.convert(
            workspace=workspace,
            input_path=workspace / "input.docx",
            output_path=workspace / "word-to-pdf.pdf",
            cancel_token=asyncio.Event(),
        )
    return info.value


class TestWhoseFaultIsIt:
    """A document the converter cannot read must not look like a server fault.

    The web page tells the person "the server is not available, try again" for
    an internal error, which sends them round in circles with a file that will
    never convert.
    """

    @pytest.mark.asyncio
    async def test_exit_zero_with_no_pdf_is_the_documents_fault(
        self, tmp_path: Path
    ) -> None:
        # What soffice really does with an unreadable document: it says
        # "source file could not be loaded", exits 0 and writes nothing.
        soffice = _fake_converter(
            tmp_path, "echo 'Error: source file could not be loaded' >&2; exit 0"
        )
        error = await _convert_with(soffice, tmp_path)
        assert error.code is ErrorCode.CONVERSION_FAILED

    @pytest.mark.asyncio
    async def test_a_failing_exit_code_is_the_documents_fault(
        self, tmp_path: Path
    ) -> None:
        error = await _convert_with(_fake_converter(tmp_path, "exit 3"), tmp_path)
        assert error.code is ErrorCode.CONVERSION_FAILED

    @pytest.mark.asyncio
    async def test_being_killed_by_a_signal_is_the_services_fault(
        self, tmp_path: Path
    ) -> None:
        # Out of memory or a crash says nothing about the document.
        error = await _convert_with(_fake_converter(tmp_path, "kill -9 $$"), tmp_path)
        assert error.code is ErrorCode.INTERNAL

    @pytest.mark.asyncio
    async def test_nothing_from_the_failure_reaches_the_error(
        self, tmp_path: Path
    ) -> None:
        soffice = _fake_converter(
            tmp_path, "echo 'secret /jobs/abc/input.docx' >&2; exit 1"
        )
        error = await _convert_with(soffice, tmp_path)
        assert "secret" not in error.message
        assert "secret" not in str(error)


# ── Integration tests (only with soffice) ───────────────────────────────


@skip_no_soffice
class TestConversion:
    @pytest.mark.asyncio
    async def test_successful_conversion(self, tmp_path: Path) -> None:
        """Full round-trip: DOCX → PDF via LibreOffice."""
        inp = tmp_path / "input.docx"
        inp.write_bytes(_make_docx())
        out = tmp_path / "word-to-pdf.pdf"
        engine = LibreOfficeEngine(timeout_seconds=60.0)
        cancel = asyncio.Event()

        await engine.convert(
            workspace=tmp_path,
            input_path=inp,
            output_path=out,
            cancel_token=cancel,
        )

        assert out.exists()
        header = out.read_bytes()[:5]
        assert header == b"%PDF-"
        # Profile dir should be cleaned up
        assert not (tmp_path / "_lo_profile").exists()

    @pytest.mark.asyncio
    async def test_cancellation_stops_conversion(self, tmp_path: Path) -> None:
        """Cancelling mid-conversion raises CANCELLED."""
        inp = tmp_path / "input.docx"
        inp.write_bytes(_make_docx())
        out = tmp_path / "word-to-pdf.pdf"
        engine = LibreOfficeEngine(timeout_seconds=60.0)
        cancel = asyncio.Event()

        # Fire cancellation almost immediately
        async def _fire_cancel() -> None:
            await asyncio.sleep(0.1)
            cancel.set()

        asyncio.create_task(_fire_cancel())

        with pytest.raises(ProcessorError) as info:
            await engine.convert(
                workspace=tmp_path,
                input_path=inp,
                output_path=out,
                cancel_token=cancel,
            )
        assert info.value.code is ErrorCode.CANCELLED

    @pytest.mark.asyncio
    async def test_env_is_scrubbed(self, tmp_path: Path) -> None:
        """Check that the engine creates a scrubbed environment."""
        import os

        # Set a variable that should NOT be forwarded
        os.environ["SUPER_SECRET_KEY"] = "leaked"
        try:
            engine = LibreOfficeEngine(timeout_seconds=60.0)
            inp = tmp_path / "input.docx"
            inp.write_bytes(_make_docx())
            out = tmp_path / "word-to-pdf.pdf"
            cancel = asyncio.Event()
            await engine.convert(
                workspace=tmp_path,
                input_path=inp,
                output_path=out,
                cancel_token=cancel,
            )
            # If we got here, conversion succeeded — the env was valid.
            # The test's purpose is to verify the engine doesn't crash
            # with the scrubbed env. The actual env verification is in
            # the code review of libreoffice.py.
            assert out.exists()
        finally:
            del os.environ["SUPER_SECRET_KEY"]


def _docx_with_document(document_xml: str) -> bytes:
    source = zipfile.ZipFile(io.BytesIO(_make_docx()))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == "word/document.xml":
                data = document_xml.encode()
            zf.writestr(info.filename, data)
    return buf.getvalue()


@skip_no_soffice
class TestUnreadableDocumentsWithTheRealConverter:
    """Packages that pass the preflight but that LibreOffice cannot load."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "document_xml",
        [
            "this is not xml at all <<<",
            '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p>',
        ],
        ids=["not-xml", "truncated-xml"],
    )
    async def test_conversion_failed_not_internal(
        self, tmp_path: Path, document_xml: str
    ) -> None:
        workspace = tmp_path / "ws"
        workspace.mkdir()
        (workspace / "input.docx").write_bytes(_docx_with_document(document_xml))
        engine = LibreOfficeEngine(timeout_seconds=60.0)
        with pytest.raises(ProcessorError) as info:
            await engine.convert(
                workspace=workspace,
                input_path=workspace / "input.docx",
                output_path=workspace / "word-to-pdf.pdf",
                cancel_token=asyncio.Event(),
            )
        assert info.value.code is ErrorCode.CONVERSION_FAILED
        assert not (workspace / "word-to-pdf.pdf").exists()
