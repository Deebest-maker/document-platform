"""DOCX preflight validator.

Rejects files before LibreOffice ever sees them. The checks are defence
in depth — they do not replace LibreOffice's own parser limits. They DO
prevent trivially hostile inputs from reaching the converter at all.

Governance §10.1 requirements addressed:
    * Zero-byte / truncated ZIP / legacy .doc / macro-enabled / encrypted
    * ZIP structure + required OOXML package parts
    * Safe path names (no traversal, absolute, NUL, backslash, duplicates)
    * Bounded entry count, bounded expanded bytes, compression-ratio control
    * Counting-inflate pass (never rely on zipfile alone for bomb protection)
    * DTD and entity-declaration rejection in every XML part, and UTF-8 only,
      so the scan cannot be dodged by changing the text encoding

This module is pure-stdlib — no external dependency.
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import PurePosixPath
from typing import Final

from app.errors import ErrorCode, ProcessorError

# ── Tunables ────────────────────────────────────────────────────────────

MAX_ZIP_ENTRIES: Final[int] = 10_000
"""Reject DOCX files with more than this many ZIP entries."""

MAX_EXPANDED_BYTES: Final[int] = 200 * 1024 * 1024  # 200 MiB
"""Total expanded (uncompressed) size cap across all entries."""

MAX_SINGLE_ENTRY_BYTES: Final[int] = 100 * 1024 * 1024  # 100 MiB
"""Single entry uncompressed size cap."""

MAX_COMPRESSION_RATIO: Final[float] = 100.0
"""Reject entries whose declared uncompressed/compressed ratio exceeds this."""

COUNTING_INFLATE_CHUNK: Final[int] = 64 * 1024  # 64 KiB
"""Chunk size for the counting-inflate pass."""

# ── XML parts: no DTDs, UTF-8 only ──────────────────────────────────────

_XML_SUFFIXES: Final[tuple[str, ...]] = (".xml", ".rels")
"""Package parts that are XML. Everything else (images, fonts, embedded
objects) is not parsed by LibreOffice as XML and is not scanned."""

_DTD_MARKERS: Final[tuple[bytes, ...]] = (b"<!doctype", b"<!entity")
"""A Word document never needs a DTD. Entity declarations are how an XML bomb
or an external-entity read is written, so either marker rejects the file.
Compared in lower case, because rejecting too much costs nothing here."""

_MARKER_OVERLAP: Final[int] = max(len(marker) for marker in _DTD_MARKERS) - 1
"""Bytes carried from one chunk to the next so a marker split by a chunk
boundary is still found."""

_XML_HEAD_BYTES: Final[int] = 256

_XML_DECLARED_ENCODING: Final[re.Pattern[bytes]] = re.compile(
    rb"""<\?xml[^>]*?\bencoding\s*=\s*["']([^"']*)["']""", re.IGNORECASE
)

# ── OLE compound-document magic (legacy .doc) ───────────────────────────

_OLE_MAGIC: Final[bytes] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

# ── Required OOXML package parts ────────────────────────────────────────

_REQUIRED_PARTS: Final[frozenset[str]] = frozenset(
    {
        "[Content_Types].xml",
        "word/document.xml",
    }
)

# ── Macro indicators ───────────────────────────────────────────────────

_MACRO_PATHS: Final[frozenset[str]] = frozenset(
    {
        "word/vbaProject.bin",
        "word/vbaData.xml",
        "xl/vbaProject.bin",  # just in case MIME lies
    }
)

# ── Encryption indicators in [Content_Types].xml ────────────────────────

_ENCRYPTED_CONTENT_TYPES: Final[frozenset[str]] = frozenset(
    {
        "application/vnd.ms-office.activeX",
        "application/vnd.ms-office.encryptedpackage",
    }
)


def validate_docx(data: bytes) -> None:
    """Validate DOCX bytes before passing to LibreOffice.

    Raises ``ProcessorError(INVALID_INPUT)`` on any rejection.
    This is a synchronous, CPU-bound function. Callers in async
    contexts should run it in a thread pool or with
    ``asyncio.to_thread``.
    """
    if len(data) == 0:
        raise ProcessorError(ErrorCode.INVALID_INPUT)

    # ── Legacy .doc detection ───────────────────────────────────────
    if data[:8] == _OLE_MAGIC:
        raise ProcessorError(ErrorCode.INVALID_INPUT)

    # ── ZIP-level checks ────────────────────────────────────────────
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise ProcessorError(ErrorCode.INVALID_INPUT)

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, Exception):
        raise ProcessorError(ErrorCode.INVALID_INPUT) from None

    with zf:
        _check_entry_safety(zf)
        _check_counting_inflate(zf)
        _check_required_parts(zf)
        _check_macros(zf)
        _check_encryption(zf)


# ── Internal checks ────────────────────────────────────────────────────


def _check_entry_safety(zf: zipfile.ZipFile) -> None:
    """Entry count, path traversal, absolute paths, NUL, backslash, dupes."""
    entries = zf.infolist()
    if len(entries) > MAX_ZIP_ENTRIES:
        raise ProcessorError(ErrorCode.INVALID_INPUT)

    seen: set[str] = set()
    for info in entries:
        name = info.filename

        # Duplicate entry names
        if name in seen:
            raise ProcessorError(ErrorCode.INVALID_INPUT)
        seen.add(name)

        # NUL byte
        if "\x00" in name:
            raise ProcessorError(ErrorCode.INVALID_INPUT)

        # Backslash (OOXML uses forward slash only)
        if "\\" in name:
            raise ProcessorError(ErrorCode.INVALID_INPUT)

        # Absolute path
        if PurePosixPath(name).is_absolute():
            raise ProcessorError(ErrorCode.INVALID_INPUT)

        # Traversal
        try:
            parts = PurePosixPath(name).parts
        except ValueError:
            raise ProcessorError(ErrorCode.INVALID_INPUT) from None
        if ".." in parts:
            raise ProcessorError(ErrorCode.INVALID_INPUT)


def _check_counting_inflate(zf: zipfile.ZipFile) -> None:
    """Bounded decompression pass — the real zip-bomb defence.

    zipfile's declared sizes can lie, so we inflate every entry in
    bounded chunks and track the running total.
    """
    total_expanded = 0

    for info in zf.infolist():
        # Skip directories
        if info.is_dir():
            continue

        # Declared-size ratio check (cheap, catches obvious bombs)
        compressed = info.compress_size
        declared = info.file_size
        if compressed > 0 and declared / compressed > MAX_COMPRESSION_RATIO:
            raise ProcessorError(ErrorCode.INVALID_INPUT)

        if declared > MAX_SINGLE_ENTRY_BYTES:
            raise ProcessorError(ErrorCode.INVALID_INPUT)

        # Actual counting-inflate. XML parts are also scanned as they stream
        # past, so no part is inflated twice.
        is_xml = info.filename.lower().endswith(_XML_SUFFIXES)
        try:
            with zf.open(info) as f:
                entry_bytes = 0
                carry = b""
                while True:
                    chunk = f.read(COUNTING_INFLATE_CHUNK)
                    if not chunk:
                        break
                    if is_xml:
                        if entry_bytes == 0:
                            _check_xml_head(chunk[:_XML_HEAD_BYTES])
                        window = carry + chunk.lower()
                        if any(marker in window for marker in _DTD_MARKERS):
                            raise ProcessorError(ErrorCode.INVALID_INPUT)
                        carry = window[-_MARKER_OVERLAP:]
                    entry_bytes += len(chunk)
                    total_expanded += len(chunk)
                    if entry_bytes > MAX_SINGLE_ENTRY_BYTES:
                        raise ProcessorError(ErrorCode.INVALID_INPUT)
                    if total_expanded > MAX_EXPANDED_BYTES:
                        raise ProcessorError(ErrorCode.INVALID_INPUT)
        except ProcessorError:
            raise
        except Exception:
            raise ProcessorError(ErrorCode.INVALID_INPUT) from None


def _check_required_parts(zf: zipfile.ZipFile) -> None:
    """Verify the minimum OOXML package parts are present."""
    names = set(zf.namelist())
    for part in _REQUIRED_PARTS:
        if part not in names:
            raise ProcessorError(ErrorCode.INVALID_INPUT)


def _check_macros(zf: zipfile.ZipFile) -> None:
    """Reject macro-enabled content."""
    names = set(zf.namelist())
    for macro_path in _MACRO_PATHS:
        if macro_path in names:
            raise ProcessorError(ErrorCode.INVALID_INPUT)


def _check_encryption(zf: zipfile.ZipFile) -> None:
    """Reject encrypted DOCX (encrypted ZIP entries or EncryptedPackage)."""
    for info in zf.infolist():
        # ZIP-level encryption flag (bit 0 of general purpose flag)
        if info.flag_bits & 0x1:
            raise ProcessorError(ErrorCode.INVALID_INPUT)

    # Check [Content_Types].xml for EncryptedPackage content type
    if "[Content_Types].xml" in set(zf.namelist()):
        try:
            ct_bytes = zf.read("[Content_Types].xml")
            ct_text = ct_bytes.decode("utf-8", errors="replace").lower()
            for marker in _ENCRYPTED_CONTENT_TYPES:
                if marker in ct_text:
                    raise ProcessorError(ErrorCode.INVALID_INPUT)
        except ProcessorError:
            raise
        except Exception:
            pass  # Content_Types parse failure caught by required-parts check


def _check_xml_head(head: bytes) -> None:
    """Require an XML part to be UTF-8.

    The DTD scan reads bytes, so it only means something for text it can read.
    UTF-16 or UTF-32 text (with or without a byte-order mark) and an XML
    declaration naming another encoding could hide a DOCTYPE from it. Word,
    Google Docs, Pages and LibreOffice all write UTF-8, so a part that is not
    is refused rather than guessed at.
    """
    if head.startswith(b"\xef\xbb\xbf"):
        head = head[3:]
    if not head:
        return
    # A NUL in the first bytes, or a first character that is not "<", is how
    # UTF-16/32 text and byte-order marks show up.
    if b"\x00" in head[:4]:
        raise ProcessorError(ErrorCode.INVALID_INPUT)
    head = head.lstrip(b" \t\r\n")
    if head and not head.startswith(b"<"):
        raise ProcessorError(ErrorCode.INVALID_INPUT)
    declared = _XML_DECLARED_ENCODING.match(head)
    if declared and declared.group(1).strip().lower() != b"utf-8":
        raise ProcessorError(ErrorCode.INVALID_INPUT)
