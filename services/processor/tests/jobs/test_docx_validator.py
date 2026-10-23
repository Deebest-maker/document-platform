"""DOCX preflight validator tests.

Creates hostile and valid DOCX fixtures programmatically using zipfile.
No external dependencies — runs on any platform.
"""

import hashlib
import io
import struct
import zipfile

import pytest

from app.errors import ErrorCode, ProcessorError
from app.jobs.validators import docx as docx_validator
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


# ── M7D: bad-input matrix additions ─────────────────────────────────────

_DOCUMENT = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    "<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
)


def _with_parts(**replacements: bytes | str) -> bytes:
    """The minimal DOCX with some parts replaced or added.

    Keyword names use ``__`` for ``/`` and ``_dot_`` for ``.`` so a part path
    can be a keyword: ``word__document_dot_xml`` is ``word/document.xml``.
    """
    source = zipfile.ZipFile(io.BytesIO(_minimal_docx()))
    parts = {info.filename: source.read(info.filename) for info in source.infolist()}
    for key, value in replacements.items():
        name = key.replace("__", "/").replace("_dot_", ".")
        parts[name] = value.encode() if isinstance(value, str) else value
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in parts.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _reject(data: bytes) -> None:
    with pytest.raises(ProcessorError) as info:
        validate_docx(data)
    assert info.value.code is ErrorCode.INVALID_INPUT


def _noise(size: int) -> bytes:
    """Deterministic text that deflates about 2:1, so it never trips the ratio rule."""
    out = bytearray()
    counter = 0
    while len(out) < size:
        out += hashlib.sha256(str(counter).encode()).hexdigest().encode()
        counter += 1
    return bytes(out[:size])


class TestDtdInEveryXmlPart:
    """The main document is where an XML bomb or an external-entity read goes."""

    def test_doctype_in_the_main_document(self) -> None:
        document = _DOCUMENT.replace(
            "<w:document",
            '<!DOCTYPE w:document SYSTEM "http://127.0.0.1:9/x.dtd"><w:document',
            1,
        ).format(text="x")
        _reject(_with_parts(word__document_dot_xml=document))

    def test_entity_expansion_in_the_main_document(self) -> None:
        entities = '<!ENTITY a "AAAAAAAAAA">' + "".join(
            f'<!ENTITY {name} "{("&" + previous + ";") * 10}">'
            for previous, name in zip("abcdefghi", "bcdefghij", strict=True)
        )
        document = _DOCUMENT.replace(
            "<w:document", f"<!DOCTYPE d [{entities}]><w:document", 1
        ).format(text="&j;")
        _reject(_with_parts(word__document_dot_xml=document))

    def test_external_entity_in_the_main_document(self) -> None:
        document = _DOCUMENT.replace(
            "<w:document",
            '<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/hostname">]><w:document',
            1,
        ).format(text="&x;")
        _reject(_with_parts(word__document_dot_xml=document))

    def test_doctype_in_a_part_the_converter_loads_later(self) -> None:
        _reject(
            _with_parts(
                word__styles_dot_xml=(
                    '<!DOCTYPE s SYSTEM "x.dtd"><w:styles xmlns:w="urn:w"/>'
                )
            )
        )

    def test_lower_case_markers_are_refused_too(self) -> None:
        _reject(_with_parts(word__document_dot_xml="<!doctype d><d/>"))
        _reject(_with_parts(word__document_dot_xml="<!entity e 'x'><d/>"))

    def test_a_marker_split_across_the_read_chunk_boundary(self) -> None:
        chunk = docx_validator.COUNTING_INFLATE_CHUNK
        for offset in range(1, len(b"<!DOCTYPE")):
            padding = b"<!--" + _noise(
                chunk - offset - 4
            )  # ends "offset" bytes before the boundary
            body = padding + b"<!DOCTYPE d><d/>"
            assert body.index(b"<!DOCTYPE") == chunk - offset
            _reject(_with_parts(word__document_dot_xml=b"<d>" + body[3:]))

    def test_text_that_only_looks_like_a_marker_is_fine(self) -> None:
        # A paragraph that talks about DOCTYPE is escaped in XML and passes.
        document = _DOCUMENT.format(text="Write &lt;!DOCTYPE html&gt; first.")
        validate_docx(_with_parts(word__document_dot_xml=document))

    def test_files_that_are_not_xml_are_not_scanned(self) -> None:
        validate_docx(
            _with_parts(word__media__image1_dot_png=b"\x89PNG <!DOCTYPE <!ENTITY")
        )


class TestXmlMustBeUtf8:
    """The scan reads bytes, so text in another encoding must not get past it."""

    def test_utf16_with_a_doctype(self) -> None:
        _reject(
            _with_parts(
                word__document_dot_xml=_DOCUMENT.format(text="<!DOCTYPE d>").encode(
                    "utf-16"
                )
            )
        )

    def test_utf16_without_a_doctype_is_refused_as_well(self) -> None:
        for encoding in ("utf-16", "utf-16-le", "utf-16-be", "utf-32"):
            _reject(
                _with_parts(
                    word__document_dot_xml=_DOCUMENT.format(text="x").encode(encoding)
                )
            )

    def test_a_declaration_naming_another_encoding(self) -> None:
        document = _DOCUMENT.replace('encoding="UTF-8"', 'encoding="UTF-7"').format(
            text="x"
        )
        _reject(_with_parts(word__document_dot_xml=document))

    def test_utf8_in_any_case_with_or_without_a_byte_order_mark(self) -> None:
        plain = _DOCUMENT.format(text="x")
        validate_docx(
            _with_parts(word__document_dot_xml=plain.replace("UTF-8", "utf-8"))
        )
        validate_docx(
            _with_parts(word__document_dot_xml=b"\xef\xbb\xbf" + plain.encode())
        )
        validate_docx(_with_parts(word__document_dot_xml="\n  " + plain))

    def test_a_part_that_does_not_start_like_xml(self) -> None:
        _reject(_with_parts(word__document_dot_xml="not xml at all"))


class TestBombControls:
    """The numeric limits, exercised for real rather than skipped when inconclusive."""

    def test_a_ten_megabyte_run_of_zeros_is_refused_on_ratio(self) -> None:
        # A .bin part, so only the ratio rule can refuse it (zeros in an .xml
        # part would be refused earlier for not being UTF-8 text).
        data = _with_parts(word__big_dot_bin=b"\x00" * (10 * 1024 * 1024))
        with zipfile.ZipFile(io.BytesIO(data)) as check:
            info = check.getinfo("word/big.bin")
            assert (
                info.file_size / info.compress_size
                > docx_validator.MAX_COMPRESSION_RATIO
            )
        _reject(data)

    def test_too_many_entries(self) -> None:
        extra = {
            f"word__p{i}_dot_xml": b"<p/>"
            for i in range(docx_validator.MAX_ZIP_ENTRIES + 1)
        }
        _reject(_with_parts(**extra))

    def test_the_whole_package_over_the_expanded_cap(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Each entry is under the single-entry cap and under the ratio cap; only
        # the total is too big. The caps are lowered so the test stays fast.
        monkeypatch.setattr(docx_validator, "MAX_EXPANDED_BYTES", 150_000)
        monkeypatch.setattr(docx_validator, "MAX_SINGLE_ENTRY_BYTES", 100_000)
        data = _with_parts(
            word__a_dot_bin=_noise(80_000), word__b_dot_bin=_noise(80_000)
        )
        _reject(data)
        validate_docx(_with_parts(word__a_dot_bin=_noise(80_000)))

    def test_one_entry_over_the_single_entry_cap(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(docx_validator, "MAX_SINGLE_ENTRY_BYTES", 50_000)
        _reject(_with_parts(word__a_dot_bin=_noise(60_000)))

    def test_a_declared_size_that_lies_is_refused(self) -> None:
        """The header claims 100 bytes; the stream holds far more.

        The checksum gives it away.
        """
        data = bytearray(_with_parts(word__big_dot_bin=_noise(300_000)))
        for signature, size_field, name_field in (
            (b"PK\x03\x04", 22, 30),
            (b"PK\x01\x02", 24, 46),
        ):
            position = 0
            while (position := data.find(signature, position)) >= 0:
                name_length = struct.unpack_from(
                    "<H", data, position + (26 if signature == b"PK\x03\x04" else 28)
                )[0]
                name = bytes(
                    data[position + name_field : position + name_field + name_length]
                )
                if name == b"word/big.bin":
                    struct.pack_into("<I", data, position + size_field, 100)
                position += 4
        with zipfile.ZipFile(io.BytesIO(bytes(data))) as check:
            assert check.getinfo("word/big.bin").file_size == 100
        _reject(bytes(data))

    def test_a_package_that_is_not_a_package(self) -> None:
        for data in (
            b"%PDF-1.7\n%%EOF\n",
            b"{\\rtf1\\ansi hello}",
            b"<html><body>hello</body></html>",
            b"PK\x05\x06" + b"\x00" * 18,  # a valid, empty zip
            b"\x89PNG\r\n\x1a\n",
            b"MZ\x90\x00",  # a Windows program
        ):
            _reject(data)
