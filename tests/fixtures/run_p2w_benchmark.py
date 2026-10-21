"""Run the M5B PDF to Word candidates over the synthetic corpus.

Measures wall time and peak resident memory (sum over the whole process tree,
sampled every 50 ms) for each conversion. Candidates:

  libreoffice  soffice --infilter=writer_pdf_import --convert-to docx
               (fresh profile per job, like the M4 Word to PDF adapter)
  prototype    tests/fixtures/p2w_prototype.py (pdfplumber + python-docx)
  pdf2docx     OPTIONAL reference only (GPL-3.0 + PyMuPDF AGPL): not eligible,
               never part of the decision. Run with --reference.

Use a prepared environment so start-up resolution is not timed:

    uv venv .tools/p2w-benchmarks/venv
    uv pip install --python .tools/p2w-benchmarks/venv/bin/python \
        pdfplumber python-docx pypdfium2 pillow lxml rapidfuzz scikit-image numpy
    .tools/p2w-benchmarks/venv/bin/python tests/fixtures/run_p2w_benchmark.py

Nothing here reads user data; inputs are the synthetic corpus only.
"""

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".tools" / "p2w-benchmarks"
CORPUS, OUT = WORK / "corpus", WORK / "out"
RESULT = ROOT / "docs" / "benchmarks" / "M5B-pdf-to-word-results.json"
PROTOTYPE = ROOT / "tests" / "fixtures" / "p2w_prototype.py"
TIMEOUT_S = 300


def tree_rss_kib(root_pid):
    """Sum VmRSS (KiB) over a process and all of its descendants."""
    children = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/stat") as handle:
                parent = int(handle.read().rsplit(")", 1)[1].split()[1])
            children.setdefault(parent, []).append(int(entry))
        except (OSError, ValueError, IndexError):
            continue
    total, stack = 0, [root_pid]
    while stack:
        pid = stack.pop()
        stack.extend(children.get(pid, []))
        try:
            with open(f"/proc/{pid}/status") as handle:
                for line in handle:
                    if line.startswith("VmRSS:"):
                        total += int(line.split()[1])
        except OSError:
            pass
    return total


def run(command, cwd=None, env=None):
    started = time.perf_counter()
    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    peak, timed_out = 0, False
    while process.poll() is None:
        peak = max(peak, tree_rss_kib(process.pid))
        if time.perf_counter() - started > TIMEOUT_S:
            process.kill(); timed_out = True; break
        time.sleep(0.05)
    out, err = process.communicate()
    return {
        "returncode": process.returncode, "wallMs": round((time.perf_counter() - started) * 1000),
        "peakRssMiB": round(peak / 1024), "timedOut": timed_out,
        "stderrTail": " ".join(err.split())[-160:] if err else "",
    }


def convert_libreoffice(pdf, target_dir):
    profile = tempfile.mkdtemp(prefix="lo-profile-")
    try:
        result = run(["soffice", f"-env:UserInstallation=file://{profile}", "--headless",
                      "--infilter=writer_pdf_import", "--convert-to", "docx:MS Word 2007 XML",
                      "--outdir", str(target_dir), str(pdf)])
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    return result, target_dir / f"{pdf.stem}.docx"


def convert_prototype(pdf, target_dir):
    target = target_dir / f"{pdf.stem}.docx"
    return run([sys.executable, str(PROTOTYPE), str(pdf), str(target)]), target


def convert_pdf2docx(pdf, target_dir):
    target = target_dir / f"{pdf.stem}.docx"
    code = "import sys; from pdf2docx import Converter; c = Converter(sys.argv[1]); c.convert(sys.argv[2]); c.close()"
    return run([sys.executable, "-c", code, str(pdf), str(target)]), target


CANDIDATES = {"libreoffice": convert_libreoffice, "prototype": convert_prototype, "pdf2docx": convert_pdf2docx}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated id prefixes")
    parser.add_argument("--candidates", default="libreoffice,prototype")
    parser.add_argument("--reference", action="store_true", help="also run pdf2docx (not eligible)")
    parser.add_argument("--merge", action="store_true", help="keep earlier runs for other cases")
    args = parser.parse_args()
    names = args.candidates.split(",") + (["pdf2docx"] if args.reference else [])
    only = [o for o in args.only.split(",") if o]
    runs = []
    for pdf in sorted(CORPUS.glob("*.pdf")):
        if only and not any(pdf.stem.startswith(o) for o in only):
            continue
        for name in names:
            repeats = 3 if pdf.stem.startswith(("A01", "D01")) and name != "pdf2docx" else 1
            for repeat in range(1, repeats + 1):
                folder = OUT / name
                folder.mkdir(parents=True, exist_ok=True)
                target = folder / f"{pdf.stem}.docx"
                target.unlink(missing_ok=True)
                measured, produced = CANDIDATES[name](pdf, folder)
                exists = produced.exists() and produced.stat().st_size > 0
                row = {"candidate": name, "id": pdf.stem, "repeat": repeat, **measured,
                       "outputExists": exists,
                       "outputBytes": produced.stat().st_size if exists else None,
                       "outputPath": str(produced.relative_to(ROOT)) if exists else None}
                runs.append(row)
                print(json.dumps({k: row[k] for k in ("candidate", "id", "repeat", "returncode", "wallMs", "peakRssMiB", "outputBytes")}), flush=True)

    kept = []
    if args.merge and RESULT.exists():
        done = {(r["candidate"], r["id"]) for r in runs}
        kept = [r for r in json.loads(RESULT.read_text())["runs"] if (r["candidate"], r["id"]) not in done]
    soffice = subprocess.run(["soffice", "--version"], capture_output=True, text=True).stdout.strip()
    RESULT.write_text(json.dumps({
        "milestone": "M5B",
        "environment": {
            "libreoffice": soffice, "python": platform.python_version(),
            "platform": f"{platform.system()} {platform.release()}",
            "cpus": os.cpu_count(), "note": "Single cold run per case unless repeat > 1; shared cloud VM; synthetic corpus.",
        },
        "runs": kept + runs,
    }, indent=1) + "\n")
    print(f"wrote {RESULT.relative_to(ROOT)} ({len(kept) + len(runs)} runs)")


if __name__ == "__main__":
    main()
