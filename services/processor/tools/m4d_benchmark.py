"""M4D benchmark harness for the Word -> PDF pipeline.

Dev-only script (not copied into the container image). It mirrors the
processor's convert path exactly: ``validate_docx`` -> ``LibreOfficeEngine``
-> PDF header / ``qpdf --check`` / page-count validation, using the real
engine against a real ``soffice``.

Corpus files are synthetic and generated from the standard library only; no
real user documents are used. See ``docs/benchmarks/M4B-libreoffice.md`` for
the methodology this implements.

Usage (from ``services/processor``)::

    uv run python -m tools.m4d_benchmark \
        --out ../../docs/benchmarks/M4D-libreoffice-results.json

Measured per run: DOCX preflight, LibreOffice conversion, PDF validation,
output size, page count, peak RSS of every process whose command line
mentions the jobs root (soffice and children), and peak workspace bytes.
HTTP and upload/download transfer time are NOT included (in-process run).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import platform
import random
import shutil
import statistics
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
import zlib
from pathlib import Path
from typing import Any

from app.errors import ProcessorError
from app.jobs.engines.libreoffice import LibreOfficeEngine
from app.jobs.validators.docx import validate_docx
from app.jobs.validators.pdf import (
    validate_pdf_header,
    validate_pdf_page_count,
    validate_pdf_qpdf,
)

MIB = 1024 * 1024
SAMPLE_INTERVAL_SECONDS = 0.05
INPUT_NAME = "input.docx"
OUTPUT_NAME = "word-to-pdf.pdf"

NS_DECL = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
)
WORDS = (
    "privacy document platform secure conversion layout paragraph "
    "benchmark measure latency memory workspace retention server "
    "upload download result portable format"
).split()


# ── Synthetic corpus ────────────────────────────────────────────────────


def noise_png(rng: random.Random, size: int) -> bytes:
    """A valid size x size RGB PNG of random noise (barely compressible)."""
    raw = b"".join(b"\x00" + rng.randbytes(size * 3) for _ in range(size))

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 1))
        + chunk(b"IEND", b"")
    )


def solid_png(width: int, height: int) -> bytes:
    """A valid single-colour PNG: tiny on disk, huge once decoded.

    Streams the deflate so the harness itself never holds the raw bitmap.
    The ZIP-level compression-ratio check cannot see this, because the
    compression lives inside the PNG stream, not the archive entry.
    """

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    row = b"\x00" + b"\xc8\x20\x20" * width
    packer = zlib.compressobj(1)
    idat = b"".join(packer.compress(row) for _ in range(height)) + packer.flush()
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


def paragraph(rng: random.Random, words: int = 90) -> str:
    text = " ".join(rng.choice(WORDS) for _ in range(words))
    return f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>"


def heading(rng: random.Random) -> str:
    text = " ".join(rng.choice(WORDS) for _ in range(4)).title()
    return (
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
        f'<w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>{text}</w:t></w:r></w:p>'
    )


def table(rng: random.Random, rows: int = 5, cols: int = 4) -> str:
    cell = '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>{}</w:tc>'
    body = "".join(
        "<w:tr>"
        + "".join(cell.format(paragraph(rng, 6)) for _ in range(cols))
        + "</w:tr>"
        for _ in range(rows)
    )
    return (
        '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/>'
        '<w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>'
        '<w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/>'
        '<w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>'
        f"{body}</w:tbl>"
    )


def inline_image(index: int, px: int) -> str:
    emu = px * 9525 // 2
    return (
        "<w:p><w:r><w:drawing>"
        '<wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{emu}" cy="{emu}"/>'
        f'<wp:docPr id="{index}" name="Picture {index}"/>'
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f'<pic:nvPicPr><pic:cNvPr id="{index}" name="image{index}.png"/>'
        "<pic:cNvPicPr/></pic:nvPicPr>"
        f'<pic:blipFill><a:blip r:embed="rIdImg{index}"/>'
        "<a:stretch><a:fillRect/></a:stretch></pic:blipFill>"
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/>'
        f'<a:ext cx="{emu}" cy="{emu}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"
    )


def build_docx(
    *,
    seed: int,
    paragraphs: int,
    tables: int = 0,
    images: int = 0,
    image_px: int = 256,
    target_bytes: int | None = None,
    png_override: bytes | None = None,
    display_px: int | None = None,
) -> bytes:
    """Build a DOCX. If ``target_bytes`` is set, keep adding images until the
    archive reaches that size (used for the size-boundary workloads).
    ``png_override`` embeds a caller-supplied PNG; ``display_px`` is the size
    the image is drawn at on the page (defaults to ``image_px``)."""
    rng = random.Random(seed)
    png = png_override or noise_png(rng, image_px)
    shown_px = display_px or image_px
    body: list[str] = []
    for i in range(paragraphs):
        if i % 12 == 0:
            body.append(heading(rng))
        body.append(paragraph(rng))
    body.extend(table(rng) for _ in range(tables))

    def assemble(count: int) -> bytes:
        parts = list(body) + [inline_image(n, shown_px) for n in range(1, count + 1)]
        document = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f"<w:document {NS_DECL}><w:body>{''.join(parts)}"
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'
            "</w:body></w:document>"
        )
        rels = "".join(
            f'<Relationship Id="rIdImg{n}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            f'relationships/image" Target="media/image{n}.png"/>'
            for n in range(1, count + 1)
        )
        buffer = _zip_bytes(
            {
                "[Content_Types].xml": (
                    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns='
                    '"http://schemas.openxmlformats.org/package/2006/content-types">'
                    '<Default Extension="rels" ContentType="application/'
                    'vnd.openxmlformats-package.relationships+xml"/>'
                    '<Default Extension="xml" ContentType="application/xml"/>'
                    '<Default Extension="png" ContentType="image/png"/>'
                    '<Override PartName="/word/document.xml" ContentType="'
                    "application/vnd.openxmlformats-officedocument."
                    'wordprocessingml.document.main+xml"/></Types>'
                ),
                "_rels/.rels": (
                    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns='
                    '"http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/'
                    'officeDocument/2006/relationships/officeDocument" '
                    'Target="word/document.xml"/></Relationships>'
                ),
                "word/document.xml": document,
                "word/_rels/document.xml.rels": (
                    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns='
                    '"http://schemas.openxmlformats.org/package/2006/relationships">'
                    f"{rels}</Relationships>"
                ),
                **{f"word/media/image{n}.png": png for n in range(1, count + 1)},
            }
        )
        return buffer

    if target_bytes is None:
        return assemble(images)
    # Each noise PNG adds ~ size^2 * 3 bytes; estimate, then top up.
    count = max(1, int(target_bytes // (len(png) + 400)))
    data = assemble(count)
    while len(data) < target_bytes:
        count += 1
        data = assemble(count)
    return data


def _zip_bytes(entries: dict[str, str | bytes]) -> bytes:
    import io

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return out.getvalue()


def corpus(w5_mib: float, w6_mib: float) -> dict[str, dict[str, Any]]:
    """Workload definitions (lazy builders keep memory low)."""
    return {
        "W1": {
            "desc": "Minimal single paragraph",
            "build": lambda: build_docx(seed=1, paragraphs=1),
        },
        "W2": {
            "desc": "~10-page report with headings",
            "build": lambda: build_docx(seed=2, paragraphs=50),
        },
        "W3": {
            "desc": "~50 pages, tables, images (~2 MiB)",
            "build": lambda: build_docx(
                seed=3, paragraphs=250, tables=10, target_bytes=2 * MIB
            ),
        },
        "W4": {
            "desc": "~200 pages, embedded images (~10 MiB)",
            "build": lambda: build_docx(
                seed=4, paragraphs=1000, tables=30, target_bytes=10 * MIB
            ),
        },
        "W5": {
            "desc": f"Near current input limit (~{w5_mib:g} MiB)",
            "heavy": True,
            "build": lambda: build_docx(
                seed=5, paragraphs=300, target_bytes=int(w5_mib * MIB)
            ),
        },
        "W6": {
            "desc": f"Governance-doc maximum (~{w6_mib:g} MiB)",
            "heavy": True,
            "build": lambda: build_docx(
                seed=6, paragraphs=300, target_bytes=int(w6_mib * MIB)
            ),
        },
        "W7": {
            "desc": "One large photo-sized raster (2000x2000, ~12 MiB)",
            "runs": 3,
            "build": lambda: build_docx(
                seed=7, paragraphs=5, images=1, image_px=2000, display_px=600
            ),
        },
        "W8": {
            "desc": "~1000-page text document (page-bound and timeout probe)",
            "runs": 3,
            "build": lambda: build_docx(seed=9, paragraphs=5600, tables=100),
        },
        "H1": {
            "desc": "Pixel bomb: 12000x12000 solid PNG (tiny file, ~432 MB decoded)",
            "runs": 2,
            "stress": True,
            "build": lambda: build_docx(
                seed=8,
                paragraphs=2,
                images=1,
                png_override=solid_png(12000, 12000),
                display_px=200,
            ),
        },
    }


# ── Rejection corpus ────────────────────────────────────────────────────


def _minimal_parts() -> dict[str, str | bytes]:
    return {
        "[Content_Types].xml": (
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/'
            'package/2006/content-types"><Default Extension="xml" '
            'ContentType="application/xml"/></Types>'
        ),
        "word/document.xml": (
            f'<?xml version="1.0"?><w:document {NS_DECL}><w:body>'
            "<w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>"
        ),
    }


def rejection_corpus() -> dict[str, tuple[str, bytes]]:
    macro = {**_minimal_parts(), "word/vbaProject.bin": b"\x00" * 64}
    encrypted = _minimal_parts()
    encrypted["[Content_Types].xml"] = (
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/'
        'package/2006/content-types"><Override PartName="/EncryptedPackage" '
        'ContentType="application/vnd.ms-office.encryptedpackage"/></Types>'
    )
    bomb = {**_minimal_parts(), "word/media/bomb.bin": b"\x00" * (50 * MIB)}
    traversal = {**_minimal_parts(), "../evil.xml": "<x/>"}
    return {
        "R1": ("Macro part (vbaProject.bin)", _zip_bytes(macro)),
        "R2": ("Encrypted package marker", _zip_bytes(encrypted)),
        "R3": ("ZIP bomb (50 MiB of zeros)", _zip_bytes(bomb)),
        "R4": (
            "Legacy .doc (OLE magic)",
            b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 4096,
        ),
        "R5": ("Path traversal entry", _zip_bytes(traversal)),
        "R6": ("Zero-byte file", b""),
    }


# ── Resource sampling ───────────────────────────────────────────────────


def _proc_kib(pid: str, key: str) -> int:
    try:
        with open(f"/proc/{pid}/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith(key):
                    return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return 0


class Sampler:
    """Polls /proc for processes tied to ``root`` and the root's disk use."""

    def __init__(self, root: Path) -> None:
        self._needle = str(root).encode()
        self._root = root
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self.peak_rss_kib = 0
        self.peak_hwm_kib = 0
        self.peak_disk_bytes = 0
        self.max_procs = 0

    def __enter__(self) -> Sampler:
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        self._thread.join(timeout=2)

    def _loop(self) -> None:
        me = str(os.getpid())
        while not self._stop.is_set():
            rss = 0
            hwm = 0
            procs = 0
            for entry in os.listdir("/proc"):
                if not entry.isdigit() or entry == me:
                    continue
                try:
                    with open(f"/proc/{entry}/cmdline", "rb") as handle:
                        cmdline = handle.read()
                except OSError:
                    continue
                if self._needle not in cmdline:
                    continue
                procs += 1
                rss += _proc_kib(entry, "VmRSS:")
                hwm += _proc_kib(entry, "VmHWM:")
            disk = 0
            for dirpath, _dirs, files in os.walk(self._root):
                for name in files:
                    try:
                        disk += os.lstat(os.path.join(dirpath, name)).st_size
                    except OSError:
                        pass
            self.peak_rss_kib = max(self.peak_rss_kib, rss)
            self.peak_hwm_kib = max(self.peak_hwm_kib, hwm)
            self.peak_disk_bytes = max(self.peak_disk_bytes, disk)
            self.max_procs = max(self.max_procs, procs)
            self._stop.wait(SAMPLE_INTERVAL_SECONDS)


# ── Pipeline ────────────────────────────────────────────────────────────


async def run_pipeline(
    data: bytes, root: Path, engine: LibreOfficeEngine, *, preflight: bool = True
) -> dict[str, Any]:
    """One end-to-end conversion, timed per stage. Never raises.

    ``preflight=False`` skips ``validate_docx`` so a stress workload can show
    what the engine alone does if a hostile file ever got past the preflight.
    """
    workspace = root / uuid.uuid4().hex
    workspace.mkdir(mode=0o700)
    input_path = workspace / INPUT_NAME
    output_path = workspace / OUTPUT_NAME
    input_path.write_bytes(data)
    result: dict[str, Any] = {"input_bytes": len(data), "ok": False}
    try:
        t0 = time.perf_counter()
        if preflight:
            await asyncio.to_thread(validate_docx, data)
        t1 = time.perf_counter()
        await engine.convert(
            workspace=workspace,
            input_path=input_path,
            output_path=output_path,
            cancel_token=asyncio.Event(),
        )
        t2 = time.perf_counter()
        validate_pdf_header(output_path)
        await validate_pdf_qpdf(output_path)
        pages = await validate_pdf_page_count(output_path)
        t3 = time.perf_counter()
        result.update(
            ok=True,
            preflight_ms=(t1 - t0) * 1000,
            convert_ms=(t2 - t1) * 1000,
            validate_ms=(t3 - t2) * 1000,
            total_ms=(t3 - t0) * 1000,
            output_bytes=output_path.stat().st_size,
            pages=pages,
        )
    except ProcessorError as exc:
        result["error_code"] = str(exc.code)
    except Exception as exc:  # noqa: BLE001 - benchmark must keep going
        result["error_code"] = f"UNEXPECTED:{type(exc).__name__}"
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
    return result


def summarize(values: list[float]) -> dict[str, float]:
    ordered = sorted(values)
    p95_index = min(len(ordered) - 1, math.ceil(0.95 * len(ordered)) - 1)
    return {
        "median": round(statistics.median(ordered), 1),
        "p95": round(ordered[p95_index], 1),
        "min": round(ordered[0], 1),
        "max": round(ordered[-1], 1),
    }


async def bench_workload(
    name: str,
    spec: dict[str, Any],
    runs: int,
    engine: LibreOfficeEngine,
    base: Path,
) -> dict[str, Any]:
    data = spec["build"]()
    print(
        f"[{name}] {spec['desc']}: {len(data) / MIB:.2f} MiB input, {runs} runs",
        flush=True,
    )
    kept: list[dict[str, Any]] = []
    failures: list[str] = []
    peaks = {"rss": 0, "hwm": 0, "disk": 0}
    stress = bool(spec.get("stress"))
    preflight_verdict = "not_applicable"
    if stress:
        # Record what the real preflight says, then measure the engine alone.
        try:
            validate_docx(data)
            preflight_verdict = "accepted"
        except ProcessorError as exc:
            preflight_verdict = f"rejected:{exc.code}"
        print(f"   preflight verdict: {preflight_verdict}", flush=True)
    for run in range(runs):
        root = Path(tempfile.mkdtemp(prefix="m4d-", dir=base))
        with Sampler(root) as sampler:
            outcome = await run_pipeline(data, root, engine, preflight=not stress)
        shutil.rmtree(root, ignore_errors=True)
        label = "cold (discarded)" if run == 0 else f"run {run}"
        if outcome["ok"]:
            print(
                f"   {label}: convert {outcome['convert_ms']:.0f} ms, "
                f"{outcome['pages']} pages, "
                f"rss {sampler.peak_rss_kib / 1024:.0f} MiB",
                flush=True,
            )
        else:
            print(f"   {label}: FAILED {outcome.get('error_code')}", flush=True)
            failures.append(str(outcome.get("error_code")))
        if run == 0:
            continue
        peaks["rss"] = max(peaks["rss"], sampler.peak_rss_kib)
        peaks["hwm"] = max(peaks["hwm"], sampler.peak_hwm_kib)
        peaks["disk"] = max(peaks["disk"], sampler.peak_disk_bytes)
        if outcome["ok"]:
            kept.append(outcome)
    summary: dict[str, Any] = {
        "description": spec["desc"],
        "preflight_verdict": preflight_verdict,
        "engine_only": stress,
        "input_bytes": len(data),
        "runs_measured": len(kept),
        "failures": failures,
        "peak_rss_mib": round(peaks["rss"] / 1024, 1),
        "peak_hwm_sum_mib": round(peaks["hwm"] / 1024, 1),
        "peak_workspace_bytes": peaks["disk"],
    }
    if kept:
        for key in ("preflight_ms", "convert_ms", "validate_ms", "total_ms"):
            summary[key] = summarize([r[key] for r in kept])
        summary["output_bytes"] = kept[-1]["output_bytes"]
        summary["pages"] = kept[-1]["pages"]
    return summary


def bench_rejections() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name, (desc, data) in rejection_corpus().items():
        timings: list[float] = []
        code = "NOT_REJECTED"
        for _ in range(5):
            start = time.perf_counter()
            try:
                validate_docx(data)
            except ProcessorError as exc:
                code = str(exc.code)
            timings.append((time.perf_counter() - start) * 1000)
        out[name] = {
            "description": desc,
            "error_code": code,
            "rejection_ms": summarize(timings),
            "under_100ms": max(timings) < 100,
        }
        print(f"[{name}] {desc}: {code}, max {max(timings):.1f} ms", flush=True)
    return out


async def bench_concurrency(
    spec: dict[str, Any], levels: list[int], engine: LibreOfficeEngine, base: Path
) -> dict[str, Any]:
    data = spec["build"]()
    results: dict[str, Any] = {}
    for level in levels:
        walls: list[float] = []
        rss = 0
        ok = 0
        for _ in range(3):
            root = Path(tempfile.mkdtemp(prefix="m4d-c-", dir=base))
            with Sampler(root) as sampler:
                start = time.perf_counter()
                outcomes = await asyncio.gather(
                    *(run_pipeline(data, root, engine) for _ in range(level))
                )
                walls.append((time.perf_counter() - start) * 1000)
            shutil.rmtree(root, ignore_errors=True)
            rss = max(rss, sampler.peak_rss_kib)
            ok += sum(1 for o in outcomes if o["ok"])
        results[str(level)] = {
            "wall_ms": summarize(walls),
            "peak_rss_mib": round(rss / 1024, 1),
            "jobs_ok": ok,
            "jobs_total": 3 * level,
        }
        print(
            f"[concurrency x{level}] median wall {statistics.median(walls):.0f} ms",
            flush=True,
        )
    return results


def host_info() -> dict[str, Any]:
    def first_line(cmd: list[str]) -> str:
        try:
            done = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            return (done.stdout or done.stderr).strip().splitlines()[0]
        except (OSError, subprocess.SubprocessError, IndexError):
            return "unavailable"

    cpu = "unknown"
    mem_kib = 0
    try:
        with open("/proc/cpuinfo", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("model name"):
                    cpu = line.split(":", 1)[1].strip()
                    break
        with open("/proc/meminfo", encoding="utf-8") as handle:
            mem_kib = int(handle.readline().split()[1])
    except (OSError, ValueError, IndexError):
        pass
    os_name = "unknown"
    try:
        with open("/etc/os-release", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("PRETTY_NAME="):
                    os_name = line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return {
        "cpu_model": cpu,
        "cpu_count": os.cpu_count(),
        "ram_mib": round(mem_kib / 1024),
        "kernel": platform.release(),
        "os": os_name,
        "python": sys.version.split()[0],
        "libreoffice": first_line(["soffice", "--version"]),
        "qpdf": first_line(["qpdf", "--version"]),
    }


def derive_gates(results: dict[str, Any]) -> dict[str, Any]:
    """Apply the M4B decision-gate formulas to the measured data."""
    core = [results["workloads"].get(k) for k in ("W1", "W2", "W3", "W4", "W5")]
    core = [c for c in core if c and c.get("runs_measured")]
    if not core:
        return {}
    max_rss = max(c["peak_rss_mib"] for c in core)
    max_disk = max(c["peak_workspace_bytes"] for c in core)
    w3 = results["workloads"].get("W3", {})
    w4 = results["workloads"].get("W4", {})
    w3_ms = w3.get("convert_ms", {}).get("median")
    w4_ms = w4.get("convert_ms", {}).get("median")
    if w4_ms is not None and w4_ms > 5000:
        concurrency = "keep 1 (W4 median > 5 s)"
    elif w3_ms is not None and w3_ms < 2000:
        concurrency = "consider >1 in a later ADR (W3 median < 2 s)"
    else:
        concurrency = "keep 1 (no gate satisfied for raising it)"
    realistic = [results["workloads"].get("W7")]
    realistic = [c for c in realistic if c and c.get("runs_measured")]
    max_rss_with_raster = max([max_rss, *(c["peak_rss_mib"] for c in realistic)])
    bomb = results["workloads"].get("H1", {})
    bomb_rss = bomb.get("peak_rss_mib")
    all_pages = [
        results["workloads"][k].get("pages", 0)
        for k in ("W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8")
        if k in results["workloads"]
    ]
    ms_per_page = None
    w8 = results["workloads"].get("W8", {})
    if w8.get("pages") and w8.get("convert_ms"):
        ms_per_page = round(w8["convert_ms"]["median"] / w8["pages"], 1)
    return {
        "page_count_bound_uncapped_2x_max_observed": 2 * max(all_pages, default=0),
        "convert_ms_per_page_w8": ms_per_page,
        "container_memory_limit_mib": math.ceil(2 * max_rss),
        "container_memory_limit_mib_incl_large_raster": math.ceil(
            2 * max_rss_with_raster
        ),
        "container_memory_limit_mib_incl_pixel_bomb": (
            math.ceil(2 * max(max_rss_with_raster, bomb_rss))
            if bomb_rss is not None
            else None
        ),
        "pixel_bomb_peak_rss_mib": bomb_rss,
        "pixel_bomb_failures": bomb.get("failures"),
        "workspace_disk_quota_mib": math.ceil(2 * max_disk / MIB),
        "page_count_sanity_bound": min(1000, 2 * max(all_pages, default=0)),
        "concurrency_decision": concurrency,
        "formulas": "memory=2x peak RSS; disk=2x peak workspace; "
        "pages=min(1000, 2x max observed)",
    }


async def main_async(args: argparse.Namespace) -> int:
    if shutil.which("soffice") is None:
        print("soffice not found on PATH; cannot benchmark.", file=sys.stderr)
        return 2
    engine = LibreOfficeEngine(timeout_seconds=args.timeout)
    wanted = {w.strip() for w in args.only.split(",") if w.strip()}
    workloads = corpus(args.w5_mib, args.w6_mib)
    results: dict[str, Any] = {
        "meta": {
            "harness": "services/processor/tools/m4d_benchmark.py",
            "label": args.label,
            "runner_timeout_seconds": args.timeout,
            "runs": args.runs,
            "heavy_runs": args.heavy_runs,
            "note": "In-process pipeline timing; HTTP and transfer time excluded.",
            "host": host_info(),
        },
        "workloads": {},
    }
    with tempfile.TemporaryDirectory(prefix="m4d-base-") as tmp:
        base = Path(tmp)
        for name, spec in workloads.items():
            if wanted and name not in wanted:
                continue
            runs = spec.get("runs") or (
                args.heavy_runs if spec.get("heavy") else args.runs
            )
            results["workloads"][name] = await bench_workload(
                name, spec, runs, engine, base
            )
        if not wanted or "W3" in wanted:
            results["concurrency_w3"] = await bench_concurrency(
                workloads["W3"], [1, 2, 4], engine, base
            )
    results["rejections"] = bench_rejections()
    results["derived_gates"] = derive_gates(results)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="M4D-libreoffice-results.json")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--heavy-runs", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--w5-mib", type=float, default=19.0)
    parser.add_argument("--w6-mib", type=float, default=50.0)
    parser.add_argument("--only", default="", help="comma list, e.g. W1,W2")
    parser.add_argument("--label", default="dev-host (not the production image)")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
