"""PDF output validator tests.

Tests the three public functions in app.jobs.validators.pdf:
    * validate_pdf_header  — synchronous, no qpdf needed
    * validate_pdf_qpdf    — async, skips if qpdf absent
    * validate_pdf_page_count — async, skips if qpdf absent
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.errors import ErrorCode, ProcessorError
from app.jobs.validators.pdf import (
    MAX_PAGES,
    validate_pdf_header,
    validate_pdf_page_count,
    validate_pdf_qpdf,
)

# ── Helpers ─────────────────────────────────────────────────────────────


def _write(tmp_path: Path, name: str, data: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(data)
    return p


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


# ── validate_pdf_header ─────────────────────────────────────────────────


class TestPdfHeader:
    def test_valid_pdf_header(self, tmp_path: Path) -> None:
        p = _write(tmp_path, "good.pdf", _MINIMAL_PDF)
        validate_pdf_header(p)  # should not raise

    def test_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(ProcessorError) as info:
            validate_pdf_header(tmp_path / "nonexistent.pdf")
        assert info.value.code is ErrorCode.INTERNAL

    def test_empty_file(self, tmp_path: Path) -> None:
        p = _write(tmp_path, "empty.pdf", b"")
        with pytest.raises(ProcessorError) as info:
            validate_pdf_header(p)
        assert info.value.code is ErrorCode.INTERNAL

    def test_wrong_magic(self, tmp_path: Path) -> None:
        p = _write(tmp_path, "bad.pdf", b"PK\x03\x04this is a zip")
        with pytest.raises(ProcessorError) as info:
            validate_pdf_header(p)
        assert info.value.code is ErrorCode.INTERNAL

    def test_directory_rejected(self, tmp_path: Path) -> None:
        d = tmp_path / "adir"
        d.mkdir()
        with pytest.raises(ProcessorError) as info:
            validate_pdf_header(d)
        assert info.value.code is ErrorCode.INTERNAL

    def test_partial_header(self, tmp_path: Path) -> None:
        """File shorter than 5 bytes does not match %PDF-."""
        p = _write(tmp_path, "short.pdf", b"%PDF")
        with pytest.raises(ProcessorError) as info:
            validate_pdf_header(p)
        assert info.value.code is ErrorCode.INTERNAL


# ── validate_pdf_qpdf ──────────────────────────────────────────────────


class TestPdfQpdf:
    @pytest.mark.asyncio
    async def test_skips_when_qpdf_absent(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When qpdf is not installed, the function returns silently."""
        monkeypatch.setattr("shutil.which", lambda _name: None)
        p = _write(tmp_path, "any.pdf", b"not even a pdf")
        await validate_pdf_qpdf(p)  # no error

    @pytest.mark.asyncio
    async def test_valid_pdf_passes_if_qpdf_present(self, tmp_path: Path) -> None:
        """If qpdf is installed, a structurally valid PDF passes."""
        import shutil

        if shutil.which("qpdf") is None:
            pytest.skip("qpdf not installed")
        p = _write(tmp_path, "good.pdf", _MINIMAL_PDF)
        await validate_pdf_qpdf(p)

    @pytest.mark.asyncio
    async def test_corrupt_pdf_rejected_if_qpdf_present(self, tmp_path: Path) -> None:
        """If qpdf is installed, a corrupt file is rejected."""
        import shutil

        if shutil.which("qpdf") is None:
            pytest.skip("qpdf not installed")
        p = _write(tmp_path, "bad.pdf", b"%PDF-1.4 garbage data here")
        with pytest.raises(ProcessorError) as info:
            await validate_pdf_qpdf(p)
        assert info.value.code is ErrorCode.INTERNAL


# ── validate_pdf_page_count ─────────────────────────────────────────────


class TestPdfPageCount:
    @pytest.mark.asyncio
    async def test_returns_zero_when_qpdf_absent(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("shutil.which", lambda _name: None)
        p = _write(tmp_path, "any.pdf", b"not a pdf")
        result = await validate_pdf_page_count(p)
        assert result == 0

    @pytest.mark.asyncio
    async def test_returns_page_count_if_qpdf_present(self, tmp_path: Path) -> None:
        import shutil

        if shutil.which("qpdf") is None:
            pytest.skip("qpdf not installed")
        p = _write(tmp_path, "good.pdf", _MINIMAL_PDF)
        result = await validate_pdf_page_count(p)
        assert result >= 0  # 1 for a valid single-page PDF

    @pytest.mark.asyncio
    async def test_page_bound_is_the_benchmarked_value(self) -> None:
        # M4D: 2x the 1,018-page document measured in the benchmark.
        assert MAX_PAGES == 2_000

    @pytest.mark.asyncio
    async def test_rejects_output_above_the_page_bound(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import shutil

        if shutil.which("qpdf") is None:
            pytest.skip("qpdf not installed")
        monkeypatch.setattr("app.jobs.validators.pdf.MAX_PAGES", 0)
        p = _write(tmp_path, "good.pdf", _MINIMAL_PDF)
        with pytest.raises(ProcessorError) as caught:
            await validate_pdf_page_count(p)
        assert caught.value.code is ErrorCode.LIMIT_EXCEEDED
