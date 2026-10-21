"""Independent evaluation of the M5A Compress PDF benchmark outputs.

Reads the raw browser results written by apps/web/benchmarks/run-compress-pdf.mjs,
then checks every produced PDF with tools that are NOT part of the product:
qpdf (structure), pdfium (rendering) and scikit-image (SSIM). Writes the merged
machine-readable result next to the raw one.

    uv run --with pypdfium2 --with scikit-image --with numpy --with pillow \
        python tests/fixtures/evaluate_compress_benchmark.py

Nothing here reads user data; inputs are the synthetic corpus only.
"""

import json
import subprocess
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from skimage.metrics import structural_similarity as ssim

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".tools" / "compress-benchmarks"
RAW = ROOT / "docs" / "benchmarks" / "M5A-compress-pdf-results.json"
MERGED = ROOT / "docs" / "benchmarks" / "M5A-compress-pdf-evaluation.json"
SAMPLE_DPIS = (100, 200)


def qpdf_check(path):
    result = subprocess.run(["qpdf", "--check", str(path)], capture_output=True, text=True)
    return result.returncode == 0, result.stdout.count("WARNING")


def render(document, index, dpi):
    bitmap = document[index].render(scale=dpi / 72).to_pil().convert("L")
    return np.asarray(bitmap)


def sample_indices(count):
    return sorted({0, count // 2, count - 1})


def fidelity(source, output):
    a, b = pdfium.PdfDocument(str(source)), pdfium.PdfDocument(str(output))
    try:
        if len(a) != len(b):
            return {"pagesEqual": False}
        indices = sample_indices(len(a))
        result = {"pagesEqual": True, "sampledPages": len(indices)}
        for dpi in SAMPLE_DPIS:
            scores = []
            for index in indices:
                x, y = render(a, index, dpi), render(b, index, dpi)
                scores.append(0.0 if x.shape != y.shape else float(ssim(x, y, data_range=255)))
            result[f"ssim{dpi}Min"] = round(min(scores), 4)
            result[f"ssim{dpi}Mean"] = round(sum(scores) / len(scores), 4)
        text = lambda d: "".join(d[i].get_textpage().get_text_range() for i in indices)
        result["textEqual"] = text(a) == text(b)
        return result
    finally:
        a.close()
        b.close()


def main():
    raw = json.loads(RAW.read_text())
    rows = []
    for run in raw["runs"]:
        row = dict(run)
        output = run.get("outputPath")
        if output and run.get("outcome") == "reduced":
            path = ROOT / output
            source = ROOT / run["sourcePath"]
            ok, warnings = qpdf_check(path)
            row["qpdfValid"], row["qpdfWarnings"] = ok, warnings
            row.update(fidelity(source, path))
            row["actualSavedPercent"] = round(100 * (1 - path.stat().st_size / source.stat().st_size), 1)
        rows.append(row)
        print(
            f"{run['id']:28s} {run['profile']:9s} {run.get('outcome', 'error'):13s} "
            f"{row.get('actualSavedPercent', '-')!s:>6} qpdf={row.get('qpdfValid', '-')} "
            f"ssim100={row.get('ssim100Min', '-')} text={row.get('textEqual', '-')}",
            flush=True,
        )
    MERGED.write_text(json.dumps({**{k: v for k, v in raw.items() if k != "runs"}, "runs": rows}, indent=1) + "\n")


if __name__ == "__main__":
    main()
