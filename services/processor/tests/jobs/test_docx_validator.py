"""DOCX preflight validator tests.

Creates hostile and valid DOCX fixtures programmatically using zipfile.
No external dependencies — runs on any platform.
"""

import io
import struct
import zipfile

import pytest

from app.errors import ErrorCode, ProcessorError
from app.jobs.validators.docx import validate_docx

# ── Helpers ─────────────────────────────────────────────────────────────


def _minimal_docx() -> bytes:
    """Build a minimal valid DOCX (ZIP with required OOXML parts)."""
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
            '"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            "</Types>",
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type='
            '"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
            ' Target="word/document.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body>"
            "</w:document>",
        )
    return buf.getvalue()


def _make_zip(**entries: bytes) -> bytes:
    """Build a ZIP from name→bytes pairs."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


# ── Happy path ──────────────────────────────────────────────────────────


class TestValidDocx:
    def test_minimal_valid_docx_passes(self) -> None:
        validate_docx(_minimal_docx())

    def test_larger_valid_docx_passes(self) -> None:
        """DOCX with several entries still passes."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "[Content_Types].xml",
                '<?xml version="1.0"?><Types xmlns='
                '"http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Override PartName="/word/document.xml" ContentType='
                '"application/vnd.openxmlformats-officedocument.'
                'wordprocessingml.document.main+xml"/></Types>',
            )
            zf.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships/>')
            zf.writestr("word/document.xml", "<document/>")
            zf.writestr("word/styles.xml", "<styles/>")
            zf.writestr("word/fontTable.xml", "<fonts/>")
            zf.writestr("word/media/image1.png", b"\x89PNG" + b"\x00" * 100)
        validate_docx(buf.getvalue())


# ── Rejection: basic format ─────────────────────────────────────────────


class TestBasicRejections:
    def test_empty_file(self) -> None:
        with pytest.raises(ProcessorError) as info:
            validate_docx(b"")
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_not_a_zip(self) -> None:
        with pytest.raises(ProcessorError) as info:
            validate_docx(b"This is just plain text, not a ZIP.")
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_truncated_zip(self) -> None:
        good = _minimal_docx()
        with pytest.raises(ProcessorError) as info:
            validate_docx(good[: len(good) // 3])
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_legacy_doc_ole_magic(self) -> None:
        """OLE compound document (legacy .doc) is rejected."""
        ole_header = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 500
        with pytest.raises(ProcessorError) as info:
            validate_docx(ole_header)
        assert info.value.code is ErrorCode.INVALID_INPUT


# ── Rejection: missing OOXML parts ──────────────────────────────────────


class TestMissingParts:
    def test_missing_content_types(self) -> None:
        data = _make_zip(**{"word/document.xml": b"<doc/>"})
        with pytest.raises(ProcessorError) as info:
            validate_docx(data)
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_missing_document_xml(self) -> None:
        data = _make_zip(**{"[Content_Types].xml": b'<?xml version="1.0"?><Types/>'})
        with pytest.raises(ProcessorError) as info:
            validate_docx(data)
        assert info.value.code is ErrorCode.INVALID_INPUT


# ── Rejection: macros ───────────────────────────────────────────────────


class TestMacroDetection:
    def test_vba_project_bin(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "<doc/>")
            zf.writestr("word/vbaProject.bin", b"\x00" * 100)
        with pytest.raises(ProcessorError) as info:
            validate_docx(buf.getvalue())
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_vba_data_xml(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "<doc/>")
            zf.writestr("word/vbaData.xml", "<vba/>")
        with pytest.raises(ProcessorError) as info:
            validate_docx(buf.getvalue())
        assert info.value.code is ErrorCode.INVALID_INPUT


# ── Rejection: encryption ───────────────────────────────────────────────


class TestEncryption:
    def test_encrypted_zip_entry_flag(self) -> None:
        """ZIP entry with encryption bit set is rejected.

        The flag must be set in the central directory (PK\\x01\\x02),
        because Python's zipfile reads flag_bits from there.
        """
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "<doc/>")
        raw = bytearray(buf.getvalue())
        # Flip encryption bit in EVERY local (PK\x03\x04) and central
        # (PK\x01\x02) header. The flag is at offset 6 in local headers
        # and at offset 8 in central directory headers.
        for sig, flag_off in [(b"PK\x03\x04", 6), (b"PK\x01\x02", 8)]:
            idx = 0
            while True:
                pos = raw.find(sig, idx)
                if pos == -1:
                    break
                offset = pos + flag_off
                flags = struct.unpack_from("<H", raw, offset)[0]
                flags |= 0x1
                struct.pack_into("<H", raw, offset, flags)
                idx = pos + 4
        with pytest.raises(ProcessorError) as info:
            validate_docx(bytes(raw))
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_encrypted_package_content_type(self) -> None:
        ct = (
            '<?xml version="1.0"?><Types>'
            '<Override PartName="/EncryptedPackage" ContentType='
            '"application/vnd.ms-office.encryptedpackage"/>'
            "</Types>"
        )
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", ct)
            zf.writestr("word/document.xml", "<doc/>")
        with pytest.raises(ProcessorError) as info:
            validate_docx(buf.getvalue())
        assert info.value.code is ErrorCode.INVALID_INPUT


# ── Rejection: path safety ──────────────────────────────────────────────


class TestPathSafety:
    def test_traversal_dotdot(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "<doc/>")
            zf.writestr("../escape.txt", "pwned")
        with pytest.raises(ProcessorError) as info:
            validate_docx(buf.getvalue())
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_absolute_path(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "<doc/>")
            zf.writestr("/etc/passwd", "pwned")
        with pytest.raises(ProcessorError) as info:
            validate_docx(buf.getvalue())
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_backslash_in_entry_name(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "<doc/>")
            zf.writestr("word\\evil.xml", "pwned")
        with pytest.raises(ProcessorError) as info:
            validate_docx(buf.getvalue())
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_nul_byte_in_entry_name(self) -> None:
        """NUL byte in an entry name is rejected.

        Python's zipfile may strip NUL bytes from names in some versions,
        so we patch the raw ZIP bytes directly in the central directory.
        """
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "<doc/>")
            zf.writestr("word/evilx.xml", "pwned")
        raw = bytearray(buf.getvalue())
        # Replace 'evilx' with 'evil\x00' in both local and central headers
        idx = 0
        while True:
            pos = raw.find(b"word/evilx.xml", idx)
            if pos == -1:
                break
            raw[pos + 9] = 0  # Replace 'x' with NUL
            idx = pos + 1
        data = bytes(raw)
        # Verify NUL is actually present
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = zf.namelist()
        has_nul = any("\x00" in n for n in names)
        if not has_nul:
            pytest.skip("zipfile stripped NUL byte — cannot test")
        with pytest.raises(ProcessorError) as info:
            validate_docx(data)
        assert info.value.code is ErrorCode.INVALID_INPUT


# ── Rejection: zip bomb / compression ───────────────────────────────────


class TestCompressionControls:
    def test_high_compression_ratio_rejected(self) -> None:
        """An entry with a suspiciously high compression ratio is rejected."""
        buf = io.BytesIO()
        # A long run of zeros compresses extremely well.
        bomb_data = b"\x00" * (10 * 1024 * 1024)  # 10 MiB of zeros
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "<doc/>")
            zf.writestr("word/bomb.xml", bomb_data)
        # The ratio of 10MiB zeros deflated is typically >100:1
        data = buf.getvalue()
        # Check if the ratio actually exceeds our limit
        with zipfile.ZipFile(io.BytesIO(data)) as check:
            for info in check.infolist():
                if info.filename == "word/bomb.xml":
                    if info.compress_size > 0:
                        ratio = info.file_size / info.compress_size
                        if ratio > 100.0:
                            with pytest.raises(ProcessorError) as exc_info:
                                validate_docx(data)
                            assert exc_info.value.code is ErrorCode.INVALID_INPUT
                            return
        # If ratio didn't exceed threshold, test is inconclusive — skip
        pytest.skip("compression ratio did not exceed threshold")


# ── Rejection: DTD ──────────────────────────────────────────────────────


class TestDtdRejection:
    def test_doctype_in_content_types(self) -> None:
        ct = '<!DOCTYPE foo SYSTEM "evil.dtd"><Types/>'
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", ct)
            zf.writestr("word/document.xml", "<doc/>")
        with pytest.raises(ProcessorError) as info:
            validate_docx(buf.getvalue())
        assert info.value.code is ErrorCode.INVALID_INPUT

    def test_entity_in_rels(self) -> None:
        rels = '<!ENTITY xxe SYSTEM "file:///etc/passwd"><Relationships/>'
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", "<Types/>")
            zf.writestr("word/document.xml", "<doc/>")
            zf.writestr("_rels/.rels", rels)
        with pytest.raises(ProcessorError) as info:
            validate_docx(buf.getvalue())
        assert info.value.code is ErrorCode.INVALID_INPUT
