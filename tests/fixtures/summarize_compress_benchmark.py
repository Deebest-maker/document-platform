"""Writes docs/benchmarks/M5A-compress-pdf.md from the evaluated benchmark data.

    python tests/fixtures/summarize_compress_benchmark.py

Reads docs/benchmarks/M5A-compress-pdf-evaluation.json (produced by
evaluate_compress_benchmark.py). Standard library only.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "benchmarks" / "M5A-compress-pdf-evaluation.json"
TARGET = ROOT / "docs" / "benchmarks" / "M5A-compress-pdf.md"

LABELS = {
    "A01-text-unoptimized": "40-page text, raw (unoptimized producer) streams",
    "A02-text-optimized": "Same text, already Flate + object streams",
    "A03-embedded-font-raw": "Text with a full TrueType font embedded raw",
    "B01-office-photos": "Office report, 5 photos 3000×2000 JPEG q90 at ~545 dpi",
    "B02-camera-photos": "4 camera photos 12 MP JPEG q92 at ~480 dpi",
    "C01-scan-color-jpeg": "8 colour scans, 300 dpi JPEG q85",
    "C02-scan-gray-flate": "3 grey scans, 300 dpi Flate",
    "C03-scan-bilevel-flate": "3 bilevel scans, 300 dpi Flate",
    "D01-screenshots-flate": "10 UI screenshots, Flate",
    "E01-lo-report-photos": "LibreOffice export: report with photos",
    "E02-lo-long-doc-images": "LibreOffice export: long document with images",
    "E03-lo-text-only": "LibreOffice export: text only",
}
STRESS = {
    "G01-jpeg-100MP": ("one 100 MP JPEG (over the 64 MP decode cap)", 1),
    "G02-flate-40MP": ("one 40 MP Flate image (over the 32 MP raster cap)", 1),
    "G03-400pages-text": ("400 text pages", 400),
    "G04-150pages-images": ("150 pages × 1200×900 JPEG", 150),
    "G05-1000pages-text": ("1,000 text pages (page cap)", 1000),
    "G06-jpeg-64MP": ("one 64 MP JPEG (exactly the decode cap)", 1),
    "G07-190pages-images": ("190 pages × JPEG, 47.6 MB (near the 50 MiB cap)", 190),
    "G08-1000pages-images": ("1,000 pages × small JPEG (image-count cap)", 1000),
    "G09-flate-31MP": ("one 31.5 MP Flate image (just under the raster cap)", 1),
}
PAGES = {"A01-text-unoptimized": 40, "B01-office-photos": 6, "B02-camera-photos": 4,
         "C01-scan-color-jpeg": 8, "C02-scan-gray-flate": 3, "D01-screenshots-flate": 10,
         "E01-lo-report-photos": 49, "E02-lo-long-doc-images": 193, "E03-lo-text-only": 9}


def mb(value):
    return f"{value / 1e6:.2f}"


def saved(run):
    if not run:
        return "–"
    if run.get("outcome") != "reduced":
        return {"no-reduction": "no file", "error": "error"}.get(run.get("outcome"), run.get("outcome"))
    return f"{run['actualSavedPercent']:.1f}%"


def ssim(profiles, key):
    run = profiles.get(key)
    return str(run["ssim100Min"]) if run and run.get("outcome") == "reduced" and "ssim100Min" in run else "–"


def main():
    data = json.loads(SOURCE.read_text())
    env, audit = data["environment"], data["privacyAudit"]
    by = {}
    for run in data["runs"]:
        if run.get("repeat", 1) == 1:
            by.setdefault(run["id"], {})[run["profile"]] = run
    reduced = [r for r in data["runs"] if r.get("outcome") == "reduced"]
    valid = sum(1 for r in reduced if r.get("qpdfValid"))
    text_bad = sum(1 for r in reduced if r.get("textEqual") is False)
    pages_bad = sum(1 for r in reduced if r.get("pagesEqual") is False)
    worst100 = {p: min(r["ssim100Min"] for r in reduced if r["profile"] == p and "ssim100Min" in r)
                for p in ("light", "balanced", "strong")}
    worst200 = min(r["ssim200Min"] for r in reduced if "ssim200Min" in r)
    repeats = {i: [r["wallMs"] for r in data["runs"] if r["id"] == i and r["profile"] == "balanced"]
               for i in ("B01-office-photos", "C01-scan-color-jpeg")}
    peak = max(data["runs"], key=lambda r: r.get("peakRendererRssMiB", 0))

    out = ["# M5A Compress PDF: Production Benchmark", ""]
    out.append(
        f"Measured on {data['generatedAt'][:10]} against the **production build** of `/compress-pdf` "
        "(file chooser → strength → Compress → download), so every number includes the worker, the browser "
        "image codec and the verification pass. Inputs are synthetic (`tests/fixtures/generate_compress_benchmark.py`) "
        "plus the committed synthetic fixtures; no user data and no filenames beyond synthetic ids are recorded. "
        "Raw results: `M5A-compress-pdf-results.json`; independent checks: `M5A-compress-pdf-evaluation.json`.")
    out.append("")
    out.append(
        f"**Environment:** {env['cpu']}, {env['memoryGiB']} GiB RAM, Chromium {env['chromium']} (headless), "
        f"Node {env['node']}, {env['platform']}. Single cold run per case (three repeats for two cases). "
        "This is desktop Chromium on a shared cloud VM: **not a public performance or memory guarantee, and not a phone**. "
        "Peak memory is the summed high-water RSS of all renderer processes (page + worker) sampled every 100 ms.")
    out += ["", "## How the outputs were checked", ""]
    out.append(
        "Every produced PDF was checked with tools that are not part of the product: `qpdf --check` (structure) and "
        "pdfium (render) with scikit-image SSIM at 100 and 200 dpi on the first, middle and last page plus up to five "
        "pages that contain images, and an extracted-text comparison on the same pages. SSIM compares the compressed "
        "render with the original render of the same page (1.0 = identical).")
    out.append("")
    out.append(f"- **{valid} of {len(reduced)}** compressed outputs pass `qpdf --check`; {len(reduced) - valid} fail.")
    out.append(f"- Extracted text differs on **{text_bad}** outputs; page counts differ on **{pages_bad}**.")
    out.append(
        f"- Worst sampled SSIM at 100 dpi: Light {worst100['light']}, Balanced {worst100['balanced']}, "
        f"Strong {worst100['strong']}; worst at 200 dpi across everything: {worst200}.")
    out.append(
        f"- Privacy audit over all {len(data['runs'])} runs: {audit['requests']} requests, {audit['crossOrigin']} "
        f"cross-origin, {audit['nonGet']} non-GET, {audit['webSockets']} WebSockets, {audit['consoleErrors']} console "
        f"errors, {audit['pageErrors']} page errors.")
    out += ["", "## Size reduction by profile", ""]
    out.append(
        'Saved % is measured on the downloaded file against the input file. "no file" means the tool reported that it '
        "could not make the PDF meaningfully smaller and created no download. SSIM is the worst sampled page at 100 dpi "
        "(Light / Balanced / Strong).")
    out += ["", "| Case | Input (MB) | Light | Balanced | Strong | SSIM (L / B / S) |", "|---|---:|---:|---:|---:|---|"]
    for ident, label in LABELS.items():
        p = by[ident]
        out.append(
            f"| {ident[:3]} {label} | {mb(p['balanced']['inputBytes'])} | {saved(p.get('light'))} | "
            f"{saved(p.get('balanced'))} | {saved(p.get('strong'))} | "
            f"{ssim(p, 'light')} / {ssim(p, 'balanced')} / {ssim(p, 'strong')} |")
    out += ["", "Reading the table honestly:", ""]
    out += [
        "- **Photo and scan documents shrink a lot** because their images are far above the target resolution "
        "(about 300–550 dpi → 150 dpi at Balanced). The synthetic images carry sensor-like noise, which downsampling "
        "removes; real photographs and scans will vary, and a PDF whose images are already at screen resolution gains "
        "little (see C03 and G08).",
        "- **Text-only files shrink only when the producer left streams uncompressed** (A01, A03, E03). An "
        "already-optimized text PDF (A02) is correctly reported as not reducible. Do not read A01's 65% as a typical text result.",
        "- **Screenshots and diagrams are deliberately left lossless** (D01: re-deflating only), because lossy JPEG "
        "damages text and sharp edges.",
        f"- **Strong is visibly softer on scans:** the worst sampled 200 dpi SSIM in the whole run is {worst200}. "
        "That is why Strong is labelled \"softer images\" in the UI.",
    ]
    out += ["", "## Time and memory (Balanced)", ""]
    out += ["| Case | Input (MB) | Pages | Time (s) | Peak renderer RSS (MiB) | Result |", "|---|---:|---:|---:|---:|---|"]
    rows = [(i, LABELS[i], PAGES[i]) for i in PAGES] + [(i, v[0], v[1]) for i, v in STRESS.items()]
    for ident, label, pages in rows:
        b = by[ident]["balanced"]
        out.append(f"| {ident[:3]} {label} | {mb(b['inputBytes'])} | {pages} | {b['wallMs'] / 1000:.1f} | "
                   f"{b['peakRendererRssMiB']} | {saved(b)} |")
    out += ["", f"Repeat variance (Balanced, ms): B01 {repeats['B01-office-photos']}, C01 {repeats['C01-scan-color-jpeg']}. "
            f"Idle page baseline is about 135 MiB renderer RSS. Highest memory measured: {peak['peakRendererRssMiB']} MiB ({peak['id'][:3]}).", ""]
    out += ["## Boundary behaviour", ""]
    out += [
        "- **An image over a decode cap is skipped, not attempted.** G01 (100 MP) and G02 (40 MP) produce no file and "
        "the page says `1 image skipped because of size, time or browser limits`; the PDF is not described as already compressed.",
        "- **The caps are met by real successes.** G06 (64 MP JPEG) and G09 (31.5 MP raster) were processed. These are the "
        "largest memory figures measured; a phone with less memory may fail where this VM did not (ADR-025, launch gate).",
        "- **Largest input** measured: 47.6 MB / 190 pages (G07). 1,000 pages (G05, G08) stay near 1–2 s.",
        "- **Fixtures:** the signed fixture is compressed with a visible warning that the signature will no longer "
        "validate; the encrypted and corrupt fixtures end in the correct messages with no output.",
    ]
    out += ["", "## Reproduce", "", "```sh", "pnpm build",
            "uv run --with pikepdf --with pillow --with numpy --with scikit-image --with fonttools --with python-docx \\",
            "  python tests/fixtures/generate_compress_benchmark.py",
            "node apps/web/benchmarks/run-compress-pdf.mjs   # --only=B01,G07 --merge re-measures a subset",
            "uv run --with pypdfium2 --with scikit-image --with numpy --with pillow \\",
            "  python tests/fixtures/evaluate_compress_benchmark.py",
            "python tests/fixtures/summarize_compress_benchmark.py", "```", "",
            "Generated PDFs and outputs stay under the ignored `.tools/compress-benchmarks/`. The LibreOffice cases need "
            "`soffice` (use `--skip-soffice` otherwise).", ""]
    TARGET.write_text("\n".join(out))


if __name__ == "__main__":
    main()
