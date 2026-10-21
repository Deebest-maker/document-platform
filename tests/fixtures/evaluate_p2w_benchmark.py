"""Independent scoring of the M5B PDF to Word benchmark.

Reads the raw conversions written by run_p2w_benchmark.py and the ground truth
written by generate_p2w_benchmark.py, then measures every DOCX with tools that
are not part of any candidate (lxml for the DOCX structure, rapidfuzz for order,
pdfium + scikit-image for rendered similarity, LibreOffice only to re-open the
output). Gates and the GO/DEFER rule come from the criteria file committed
before any measurement: docs/benchmarks/M5B-pdf-to-word-criteria.md.

    .tools/p2w-benchmarks/venv/bin/python tests/fixtures/evaluate_p2w_benchmark.py
"""

import json
import re
import shutil
import statistics
import subprocess
import tempfile
import time
import unicodedata
import zipfile
from collections import Counter
from importlib import metadata
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from docx import Document
from lxml import etree
from PIL import Image
from rapidfuzz.distance import Indel
from skimage.metrics import structural_similarity as ssim

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".tools" / "p2w-benchmarks"
RAW = ROOT / "docs" / "benchmarks" / "M5B-pdf-to-word-results.json"
EVAL = ROOT / "docs" / "benchmarks" / "M5B-pdf-to-word-evaluation.json"
MD = ROOT / "docs" / "benchmarks" / "M5B-pdf-to-word.md"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
V = "{urn:schemas-microsoft-com:vml}"
TEXT_BLOCKS = {"heading", "paragraph", "list_item", "caption", "sidebar", "label", "bullet"}
PROSE = {"A01-prose-headings", "A02-emphasis-lists", "A03-report-furniture", "A06-images-captions"}
ELIGIBLE = {"libreoffice": True, "prototype": True, "pdf2docx": False}


def tokens(text):
    return re.findall(r"\w+", unicodedata.normalize("NFKC", text).casefold())


# ---- DOCX reading --------------------------------------------------------


def own_text(paragraph):
    out = []

    def walk(element):
        for child in element:
            if child.tag == W + "p":
                continue  # nested paragraph (text box content) is read on its own
            if child.tag == W + "t":
                out.append(child.text or "")
            elif child.tag in (W + "tab", W + "br"):
                out.append(" ")
            walk(child)

    walk(paragraph)
    return "".join(out)


def container(paragraph):
    node = paragraph
    in_cell = False
    while node is not None:
        if node.tag == W + "txbxContent":
            return "frame"
        if node.tag == W + "tc":
            in_cell = True
        node = node.getparent()
    if paragraph.find(f"{W}pPr/{W}framePr") is not None:
        return "frame"
    return "table" if in_cell else "flow"


def parse_part(data):
    root = etree.fromstring(data)
    for fallback in list(root.iter(MC + "Fallback")):
        fallback.getparent().remove(fallback)
    return root


def read_docx(path):
    archive = zipfile.ZipFile(path)
    if archive.testzip() is not None:
        raise zipfile.BadZipFile("corrupt member")
    root = parse_part(archive.read("word/document.xml"))
    paragraphs = [(container(p), own_text(p)) for p in root.iter(W + "p")]
    furniture = []
    for name in archive.namelist():
        if re.match(r"word/(header|footer)\d*\.xml$", name):
            part = parse_part(archive.read(name))
            furniture += [own_text(p) for p in part.iter(W + "p")]
    tables = []
    body = root.find(W + "body")
    for table in body.iter(W + "tbl"):
        if any(a.tag == W + "tbl" for a in table.iterancestors()):
            continue
        rows = []
        for row in table.findall(W + "tr"):
            rows.append([" ".join(tokens(" ".join(own_text(p) for p in cell.iter(W + "p")))) for cell in row.findall(W + "tc")])
        tables.append(rows)
    images = len(list(root.iter(A + "blip"))) + len(list(root.iter(V + "imagedata")))
    return {"paragraphs": paragraphs, "furniture": furniture, "tables": tables, "images": images}


# ---- metrics -------------------------------------------------------------


def truth_tokens(truth):
    sequence, paragraphs = [], 0
    for block in truth["blocks"]:
        if block["type"] == "table":
            for row in block["rows"]:
                for cell in row:
                    sequence += tokens(cell)
        elif block["type"] in TEXT_BLOCKS:
            sequence += tokens(block["text"])
            paragraphs += 1
    return sequence, paragraphs


def overlap(a, b):
    return sum((Counter(a) & Counter(b)).values())


def text_metrics(truth, docx):
    body_truth, truth_paragraphs = truth_tokens(truth)
    furniture_truth = tokens(" ".join(truth["furniture"]))
    body_out = [t for _, text in docx["paragraphs"] for t in tokens(text)]
    furniture_out = [t for text in docx["furniture"] for t in tokens(text)]
    all_truth, all_out = body_truth + furniture_truth, body_out + furniture_out
    hit = overlap(all_truth, all_out)
    vocabulary = set(furniture_truth)  # words that also occur in headers/footers are ignored on both sides
    order = Indel.normalized_similarity([t for t in body_truth if t not in vocabulary],
                                        [t for t in body_out if t not in vocabulary]) if body_truth else None
    chars = Counter()
    for kind, text in docx["paragraphs"]:
        chars[kind] += sum(len(t) for t in tokens(text))
    total = sum(chars.values())
    flow_paragraphs = sum(1 for kind, text in docx["paragraphs"] if kind == "flow" and tokens(text))
    return {
        "truthWords": len(all_truth), "outputWords": len(all_out),
        "recall": round(hit / len(all_truth), 4) if all_truth else None,
        "precision": round(hit / len(all_out), 4) if all_out else None,
        "order": round(order, 4) if order is not None else None,
        "flowShare": round((chars["flow"] + chars["table"]) / total, 4) if total else None,
        "frameShare": round(chars["frame"] / total, 4) if total else None,
        "flowParagraphs": flow_paragraphs, "truthParagraphs": truth_paragraphs,
        "fragmentation": round(flow_paragraphs / truth_paragraphs, 2) if truth_paragraphs else None,
    }


def table_metrics(truth, docx):
    expected = [b["rows"] for b in truth["blocks"] if b["type"] == "table"]
    if not expected:
        return None
    scores = []
    for rows in expected:
        wanted = [[" ".join(tokens(c)) for c in row] for row in rows]
        best = 0.0
        for table in docx["tables"]:
            ok = sum(1 for r, row in enumerate(wanted) for c, cell in enumerate(row)
                     if r < len(table) and c < len(table[r]) and table[r][c] == cell)
            best = max(best, ok / sum(len(row) for row in wanted))
        scores.append(round(best, 4))
    return {"truthTables": len(expected), "outputTables": len(docx["tables"]), "cellScores": scores,
            "recovered": sum(1 for s in scores if s >= 0.90)}


REOPEN_TIMEOUT_S = 300


def soffice_pdf(docx_path, target_dir):
    profile = tempfile.mkdtemp(prefix="lo-profile-")
    try:
        result = subprocess.run(["soffice", f"-env:UserInstallation=file://{profile}", "--headless",
                                 "--convert-to", "pdf", "--outdir", str(target_dir), str(docx_path)],
                                capture_output=True, timeout=REOPEN_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return None
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    out = Path(target_dir) / (Path(docx_path).stem + ".pdf")
    return out if result.returncode == 0 and out.exists() else None


def gray(page, dpi=72):
    return np.asarray(page.render(scale=dpi / 72).to_pil().convert("L"))


def visual_metrics(source_pdf, rendered_pdf, with_ssim):
    try:
        a, b = pdfium.PdfDocument(str(source_pdf)), pdfium.PdfDocument(str(rendered_pdf))
    except Exception as error:  # noqa: BLE001 - e.g. the corrupt input cannot be opened
        return {"visualError": type(error).__name__}
    result = {"sourcePages": len(a), "outputPages": len(b)}
    if with_ssim:
        scores = []
        for index in range(len(a)):
            if index >= len(b):
                scores.append(0.0); continue
            x = gray(a[index])
            y = np.asarray(Image.fromarray(gray(b[index])).resize((x.shape[1], x.shape[0])))
            scores.append(float(ssim(x, y, data_range=255)))
        result["ssim"] = [round(s, 4) for s in scores]
    a.close(); b.close()
    return result


def scanned_pages(pdf_path):
    try:
        document = pdfium.PdfDocument(str(pdf_path))
    except Exception:
        return None
    flags = [document[i].get_textpage().count_chars() == 0 for i in range(len(document))]
    document.close()
    return flags


def calibrate_ssim():
    """What does the visual gate measure? SSIM of every Class A page against
    itself moved by 0, 1 and 2 pixels (1 px = 1 pt = 0.35 mm at 72 dpi)."""
    result = {}
    scores = {0: [], 1: [], 2: []}
    for name in sorted(WORK.joinpath("corpus").glob("A0*.pdf")):
        document = pdfium.PdfDocument(str(name))
        for index in range(len(document)):
            page = gray(document[index])
            for shift in scores:
                moved = np.roll(page, (shift, shift), axis=(0, 1)) if shift else page
                scores[shift].append(float(ssim(page, moved, data_range=255)))
        document.close()
    for shift, values in scores.items():
        result[f"shift{shift}px"] = {"medianSsim": round(statistics.median(values), 3), "pages": len(values)}
    return result


# ---- gates ---------------------------------------------------------------


def evaluate_gates(name, rows, runs, detection):
    by_id = {r["id"]: r for r in rows}
    klass = lambda r: r["class"]
    a = [r for r in rows if klass(r) == "A"]
    b = [r for r in rows if klass(r) == "B"]
    gates = {}

    def ok_all(items, test):
        return all(test(r) for r in items) and bool(items)

    g1 = ok_all(a, lambda r: (r.get("recall") or 0) >= 0.99 and (r.get("precision") or 0) >= 0.98) \
        and ok_all(b, lambda r: (r.get("recall") or 0) >= 0.97) \
        and ok_all(a + b, lambda r: (r.get("recall") or 0) >= 0.95)
    gates["G1 text integrity"] = g1
    gates["G2 reading order"] = ok_all(a, lambda r: (r.get("order") or 0) >= 0.98) and ok_all(b, lambda r: (r.get("order") or 0) >= 0.90)
    gates["G3 editability"] = ok_all(a, lambda r: (r.get("flowShare") or 0) >= 0.90) \
        and ok_all([r for r in a if r["id"] in PROSE], lambda r: r.get("fragmentation") is not None and r["fragmentation"] <= 1.5)
    tabled = [r for r in a if r.get("tables")]
    truth_tables = sum(r["tables"]["truthTables"] for r in tabled)
    recovered = sum(r["tables"]["recovered"] for r in tabled)
    gates["G4 tables"] = truth_tables > 0 and recovered / truth_tables >= 0.80
    img = by_id.get("A06-images-captions")
    gates["G5 images"] = bool(img) and img.get("images") is not None and img["images"] >= img.get("truthImages", 0)
    pages_ok = ok_all(a, lambda r: r.get("outputPages") is not None and abs(r["outputPages"] - r["sourcePages"]) <= max(1, 0.15 * r["sourcePages"]))
    ssims = [s for r in a for s in r.get("ssim", [])]
    gates["G6 visual"] = pages_ok and bool(ssims) and statistics.median(ssims) >= 0.70
    c01 = by_id.get("C01-scanned")
    detected = detection["C01-scanned"] and all(detection["C01-scanned"]) and not any(any(f) for k, f in detection.items() if k != "C01-scanned" and k != "C02-scanned-ocr-layer" and f)
    clean = (not c01) or (c01.get("hiddenLeak", 0) <= 0.01 and (c01.get("outputWords") or 0) <= 5)
    gates["G7 scanned"] = bool(detected) and bool(clean)
    ops = True
    notes = []
    for row_id, limit in (("D01-50-pages", 60), ("D02-200-pages", 120), ("D03-near-20MiB", 120)):
        group = [r for r in runs if r["id"] == row_id and r["candidate"] == name]
        if not group:
            ops = False; notes.append(f"{row_id} not run"); continue
        median = statistics.median(r["wallMs"] for r in group) / 1000
        if median > limit or any(r["timedOut"] or not r["outputExists"] for r in group):
            ops = False; notes.append(f"{row_id} {median:.1f}s > {limit}s or failed")
    peak = max((r["peakRssMiB"] for r in runs if r["candidate"] == name), default=0)
    if peak > 1024:
        ops = False; notes.append(f"peak {peak} MiB > 1024")
    for row_id in ("D04-encrypted", "D05-corrupt"):
        group = [r for r in runs if r["id"] == row_id and r["candidate"] == name]
        if not group or not all((not r["outputExists"] or r["returncode"] != 0) and r["wallMs"] <= 10_000 and not r["timedOut"] for r in group):
            ops = False; notes.append(f"{row_id} not a clean failure")
    gates["G8 operational"] = ops
    produced = [r for r in rows if r.get("valid") is not None]
    gates["G9 validity"] = bool(produced) and all(r["valid"] for r in produced)
    gates["G10 licence/offline"] = ELIGIBLE.get(name, False)
    return gates, notes, peak


# ---- report --------------------------------------------------------------


def pct(value):
    return "n/a" if value is None else f"{value * 100:.1f}%"


def worst(rows, key, klass, low=True):
    values = [(r[key], r["id"]) for r in rows if r["class"] == klass and r.get(key) is not None]
    if not values:
        return "n/a"
    value, name = (min if low else max)(values)
    return f"{value if key == 'fragmentation' else pct(value)} ({name.split('-')[0]})"


def gate_detail(candidate):
    rows, a = candidate["rows"], [r for r in candidate["rows"] if r["class"] == "A"]
    tabled = [r for r in a if r.get("tables")]
    ssims = [x for r in a for x in r.get("ssim", [])]
    deltas = [f"{r['id'].split('-')[0]} {r['sourcePages']}->{r['outputPages']}" for r in a if "outputPages" in r and "sourcePages" in r]
    prose = [r for r in a if r["id"] in PROSE and r.get("fragmentation") is not None]
    c01 = next((r for r in rows if r["id"] == "C01-scanned"), {})
    return {
        "G1 text integrity": f"worst A recall {worst(rows, 'recall', 'A')}, worst A precision {worst(rows, 'precision', 'A')}, worst B recall {worst(rows, 'recall', 'B')}",
        "G2 reading order": f"worst A order {worst(rows, 'order', 'A')}, worst B order {worst(rows, 'order', 'B')}",
        "G3 editability": f"lowest A flow share {worst(rows, 'flowShare', 'A')}, highest prose fragmentation {max((r['fragmentation'] for r in prose), default='n/a')}",
        "G4 tables": f"{sum(r['tables']['recovered'] for r in tabled)}/{sum(r['tables']['truthTables'] for r in tabled)} tables with >=90% cells correct",
        "G5 images": next((f"A06 {r.get('images')} of {r['truthImages']}" for r in a if r['id'].startswith('A06')), "n/a"),
        "G6 visual": f"median SSIM {statistics.median(ssims):.3f}; pages " + ", ".join(deltas) if ssims else "n/a",
        "G7 scanned": f"C01 hidden-word leak {pct(c01.get('hiddenLeak'))}, output words {c01.get('outputWords')}",
    }


def render_markdown(evaluation):
    lines = ["# M5B PDF to Word fidelity benchmark: results", "",
             f"**Decision: {evaluation['decision']}**" + (f" ({', '.join(evaluation['goCandidates'])})" if evaluation["goCandidates"] else ""), "",
             "Gates are those fixed in [M5B-pdf-to-word-criteria.md](M5B-pdf-to-word-criteria.md) before any measurement. "
             "Raw conversions: [M5B-pdf-to-word-results.json](M5B-pdf-to-word-results.json); scoring detail: "
             "[M5B-pdf-to-word-evaluation.json](M5B-pdf-to-word-evaluation.json). "
             f"Environment: {evaluation['environment']['libreoffice']}, Python {evaluation['environment']['python']}, {evaluation['environment']['cpus']} vCPU shared VM, synthetic corpus.", ""]
    for name, candidate in evaluation["candidates"].items():
        detail = gate_detail(candidate)
        lines += [f"## {name}" + ("" if candidate["eligible"] else " (reference, not eligible)"), "",
                  "| Gate | Result | Measured |", "| --- | --- | --- |"]
        for gate, passed in candidate["gates"].items():
            measured = detail.get(gate, "; ".join(candidate["gateNotes"]) if gate.startswith("G8") and candidate["gateNotes"] else "")
            if gate.startswith("G8"):
                measured = (measured + "; " if measured else "") + f"peak {candidate['peakRssMiB']} MiB"
            lines.append(f"| {gate} | {'pass' if passed else '**FAIL**'} | {measured} |")
        lines += ["", "| File | Recall | Precision | Order | Flow share | Fragmentation | Tables ok | Images | Pages | Median SSIM | Wall | Peak RSS |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
        for r in candidate["rows"]:
            ssims = r.get("ssim") or []
            tables = r.get("tables")
            lines.append("| {id} | {rec} | {pre} | {order} | {flow} | {frag} | {tab} | {img} | {pages} | {ssim} | {wall} | {rss} |".format(
                id=r["id"], rec=pct(r.get("recall")), pre=pct(r.get("precision")), order=pct(r.get("order")),
                flow=pct(r.get("flowShare")), frag=r.get("fragmentation", "n/a") if r.get("fragmentation") is not None else "n/a",
                tab=f"{tables['recovered']}/{tables['truthTables']}" if tables else "-",
                img=f"{r.get('images')}/{r['truthImages']}" if r.get("images") is not None and r["truthImages"] else (str(r.get("images", "-"))),
                pages=f"{r['sourcePages']}->{r['outputPages']}" if "outputPages" in r else "-",
                ssim=f"{statistics.median(ssims):.2f}" if ssims else "-",
                wall=f"{r['wallMs'] / 1000:.1f} s" if "wallMs" in r else "-", rss=f"{r['peakRssMiB']} MiB" if "peakRssMiB" in r else "-"))
        lines.append("")
    calibration = evaluation.get("ssimCalibration")
    if calibration:
        lines += ["## What the visual gate (G6) measures", "",
                  "SSIM of each Class A page against the same page moved by a few pixels (1 px = 1 pt = 0.35 mm at 72 dpi):", "",
                  "| Shift | Median SSIM |", "| --- | --- |"]
        lines += [f"| {key.replace('shift', '').replace('px', '')} px | {value['medianSsim']:.3f} |" for key, value in calibration.items()]
        lines += ["", "A one-point shift already scores below the 0.70 threshold, so G6 as written demands sub-point positional "
                  "agreement on every page. The two candidates score alike (see the tables above) although LibreOffice places "
                  "every line at an absolute position and the prototype reflows text, which suggests the metric is dominated by "
                  "small offsets and glyph rasterisation rather than layout quality. G6 is reported as pre-registered and "
                  "decides the outcome by rule; the calibration is a measurement-design finding, not evidence of poor "
                  "fidelity. See ADR-027.", ""]
    lines += ["## Sensitivity (not the decision rule)", "", "| Candidate | Failed gates | Failed gates if G6 were set aside |", "| --- | --- | --- |"]
    for name, candidate in evaluation["candidates"].items():
        failed = ", ".join(g.split(" ")[0] for g in candidate.get("failedGates", [])) or "none"
        rest = ", ".join(g.split(" ")[0] for g in candidate.get("failedGatesExcludingG6", [])) or "none"
        lines.append(f"| {name} | {failed} | {rest} |")
    lines.append("")
    MD.write_text("\n".join(lines) + "\n")


def main(only=None):
    raw = json.loads(RAW.read_text())
    truths = {p.stem: json.loads(p.read_text()) for p in sorted((WORK / "truth").glob("*.json"))}
    # Detection is a property of the source PDF (pdfium character count); encrypted and corrupt inputs are not text-layer pages.
    detection = {i: (None if t.get("expect_failure") else scanned_pages(WORK / "corpus" / f"{i}.pdf")) for i, t in truths.items()}
    candidates = sorted({r["candidate"] for r in raw["runs"]})
    evaluation = {"environment": raw["environment"], "scannedDetection": detection, "candidates": {}}
    if only:  # re-score selected candidates, keep the others from the previous evaluation
        previous = json.loads(EVAL.read_text())
        evaluation["candidates"] = {n: c for n, c in previous["candidates"].items() if n not in only}
    for name in candidates:
        if only and name not in only:
            continue
        rows = []
        for truth_id, truth in truths.items():
            first = next((r for r in raw["runs"] if r["candidate"] == name and r["id"] == truth_id and r["outputExists"]), None)
            row = {"id": truth_id, "class": truth["class"], "producer": truth["producer"], "truthImages": truth["images"]}
            runs_here = [r for r in raw["runs"] if r["candidate"] == name and r["id"] == truth_id]
            if runs_here:
                row["wallMs"] = round(statistics.median(r["wallMs"] for r in runs_here))
                row["peakRssMiB"] = max(r["peakRssMiB"] for r in runs_here)
                row["returncode"] = runs_here[0]["returncode"]
            if first is None:
                row["output"] = "none"
                rows.append(row); continue
            path = ROOT / first["outputPath"]
            row["output"] = "docx"
            try:
                docx = read_docx(path)
                Document(str(path))
                row["valid"] = True
            except Exception as error:  # noqa: BLE001 - recorded, not hidden
                row["valid"], row["invalidReason"] = False, type(error).__name__
                rows.append(row); continue
            row.update(text_metrics(truth, docx))
            row["images"] = docx["images"]
            tables = table_metrics(truth, docx)
            if tables:
                row["tables"] = tables
            with tempfile.TemporaryDirectory() as tmp:
                started = time.perf_counter()
                rendered = soffice_pdf(path, tmp)
                row["reopenSeconds"] = round(time.perf_counter() - started, 1)
                if rendered is None:
                    row["valid"], row["invalidReason"] = False, f"LibreOffice did not produce a PDF within {REOPEN_TIMEOUT_S} s"
                else:
                    row.update(visual_metrics(WORK / "corpus" / f"{truth_id}.pdf", rendered, with_ssim=truth["class"] in ("A", "B")))
            if truth["scanned"]:
                hidden = Counter(tokens(" ".join(truth.get("hidden", []))))
                produced = tokens(" ".join(t for _, t in docx["paragraphs"]))
                row["hiddenLeak"] = round(sum((Counter(produced) & hidden).values()) / max(1, sum(hidden.values())), 4)
            rows.append(row)
            print(f"{name:12s} {truth_id:26s} recall={row.get('recall')} prec={row.get('precision')} order={row.get('order')} flow={row.get('flowShare')} pages={row.get('sourcePages')}->{row.get('outputPages')}", flush=True)
        gates, notes, peak = evaluate_gates(name, rows, [r for r in raw["runs"]], detection)
        decision = all(gates.values())
        evaluation["candidates"][name] = {
            "eligible": ELIGIBLE.get(name, False), "rows": rows, "gates": gates, "gateNotes": notes,
            "peakRssMiB": peak, "passesAllGates": decision,
        }
        print(name, "gates:", {k: v for k, v in gates.items()}, notes, flush=True)
    evaluation["ssimCalibration"] = calibrate_ssim()
    for candidate in evaluation["candidates"].values():
        candidate["failedGates"] = [g for g, ok in candidate["gates"].items() if not ok]
        candidate["failedGatesExcludingG6"] = [g for g in candidate["failedGates"] if not g.startswith("G6")]
    eligible = [n for n, c in evaluation["candidates"].items() if c["eligible"] and c["passesAllGates"]]
    evaluation["decision"] = "GO" if eligible else "DEFER"
    evaluation["goCandidates"] = eligible
    licences = {}
    for package in ("pdfplumber", "pdfminer.six", "python-docx", "pypdfium2", "pillow", "lxml", "rapidfuzz"):
        try:
            info = metadata.metadata(package)
            licences[package] = (info.get("License-Expression") or info.get("License") or "").split("\n")[0][:60] or next(
                (c.split("::")[-1].strip() for c in (info.get_all("Classifier") or []) if c.startswith("License")), "")
        except metadata.PackageNotFoundError:
            licences[package] = "not installed"
    evaluation["prototypeLicences"] = licences
    EVAL.write_text(json.dumps(evaluation, indent=1) + "\n")
    render_markdown(evaluation)
    print("decision:", evaluation["decision"], eligible)


if __name__ == "__main__":
    import sys

    for argument in sys.argv:
        if argument.startswith("--reopen-timeout="):
            REOPEN_TIMEOUT_S = int(argument.split("=", 1)[1])
    if "--render-only" in sys.argv:
        render_markdown(json.loads(EVAL.read_text()))
    else:
        chosen = [a.split("=", 1)[1].split(",") for a in sys.argv if a.startswith("--only=")]
        main(chosen[0] if chosen else None)
