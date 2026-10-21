# ADR-027: PDF to Word is deferred to V1.1 (M5B fidelity benchmark)

**Status:** Decision recorded under the approved M5 gate; Product Owner acceptance pending
**Date:** 2026-10-21
**Scope:** The M5B fidelity benchmark and its GO/DEFER decision. No product code, no tool page, no dependency and no infrastructure was added.
**Relates to:** SRS FR-P2W-001..004; QA strategy ("benchmark-based fidelity threshold; move out of MVP if quality gate fails"); ADR-022 (LibreOffice adapter); ADR-024 (processor limits).
**Criteria:** [`M5B-pdf-to-word-criteria.md`](../benchmarks/M5B-pdf-to-word-criteria.md), committed before any measurement.
**Evidence:** [`M5B-pdf-to-word.md`](../benchmarks/M5B-pdf-to-word.md), [`M5B-pdf-to-word-results.json`](../benchmarks/M5B-pdf-to-word-results.json), [`M5B-pdf-to-word-evaluation.json`](../benchmarks/M5B-pdf-to-word-evaluation.json), and the untouched first round (`*-round1.json`).

## Context

The architecture and QA documents make PDF to Word conditional: build it only if a benchmark shows acceptable fidelity, otherwise move it out of the MVP. The SRS requires that we attempt DOCX conversion, disclose that fidelity varies, offer the DOCX, and never present a scanned or image-only PDF as editable text unless OCR was performed.

Eligibility was fixed first. Excluded: PyMuPDF and Ghostscript (AGPL), pdf2docx (GPL-3.0 and built on PyMuPDF), poppler `pdftohtml` (GPL), and any cloud or commercial API. Two candidates were eligible:

- **A. LibreOffice** `writer_pdf_import` to DOCX (MPL 2.0; already in the hardened processor container).
- **B. A first-party prototype** (about 350 lines of Python: pdfplumber and pdfminer.six, python-docx, pypdfium2). It exists only to measure what building it ourselves could reach.

## Decision

**DEFER.** No eligible candidate passes every pre-registered gate, so PDF to Word moves to V1.1, as the architecture directs. The tool stays `planned` in the catalog. Nothing is built.

| Gate                 | LibreOffice | Prototype (final) |
| -------------------- | ----------- | ----------------- |
| G1 Text integrity    | pass        | pass              |
| G2 Reading order     | **fail**    | pass              |
| G3 Editability       | **fail**    | pass              |
| G4 Tables            | **fail**    | pass              |
| G5 Images            | pass        | pass              |
| G6 Visual similarity | **fail**    | **fail**          |
| G7 Scanned handling  | pass        | pass              |
| G8 Operational       | **fail**    | pass              |
| G9 Validity          | pass        | pass              |
| G10 Licence, offline | pass        | pass              |

The rule had no third outcome and no thresholds were changed after measurement.

## Findings

**LibreOffice keeps the words but not a usable Word document.**

- Text is complete: recall 100% on every file and precision 99.4% or better.
- It writes **one text box per text line** and no flowing paragraphs: 96 text boxes for the 96 lines of A01, 830 across the six Class A files, 7,885 for the 198-page file. Flow share is 0% everywhere, so the result is not editable the way a Word document is.
- Tables are not recovered: 0 of 3 become Word tables.
- Column order is wrong in multi-column layouts: 53.6% on the two-column file and 36.6% on the three-column file with a sidebar.
- A corrupt (truncated) input exits 0 and produces a DOCX whose only content is the sentence "This PDF file is encrypted and can't be opened." A wrapper cannot trust the exit code; it must validate the PDF first. An encrypted input produced no output.
- Speed and memory are fine: 50 pages in 6.5 s, 198 pages in 61.8 s (limit 120 s), peak 615 MiB. But LibreOffice then needed 462 s to re-open its own 198-page output, and 121.6 s for the 3-page data table. Word's behaviour with thousands of text boxes was not measured.

**The prototype is editable and, after one round of fixes, passes every gate except G6.**

- Round 1 (as first built) failed G1, G2, G4, G6 and G8. Four defects explained it: a table that shared a layout group with other content was silently dropped (data table recall 59.6%); Arabic arrived in drawn order and unreadable (recall 0%); two prose columns on a shared baseline grid were read as a form row and interleaved (order 86.2%); and memory held every page (1,330 MiB at 198 pages).
- Those four were fixed once and the whole set re-run. Round 2: text recall and precision 100%, order 97.9% or better, flow share 100%, fragmentation 1.28 at most on prose, 3 of 3 tables, 3 of 3 images, scans detected with no invented text, peak 142 MiB, 24.3 s for 198 pages. The first-round files are kept unchanged beside the final ones.
- It grows documents when reflowed with default Word styles (50 to 69 pages, 198 to 280). Class A files stayed within one page of the original.

**G6 is miscalibrated, and it is the only gate the prototype fails.** The gate asks for median SSIM of at least 0.70 at 72 dpi. Moving a page by **one point (0.35 mm)** scores 0.698, and two points 0.638. The two candidates score alike (LibreOffice 0.579, prototype 0.574) although one positions every line absolutely and the other reflows. The metric is dominated by tiny offsets and glyph rasterisation, so it cannot tell good layout from poor. G6 is reported as written and decides the outcome by rule; the calibration is a finding about the measurement, not about fidelity.

## What this does and does not show

- The corpus is **synthetic and I wrote both the corpus and the prototype**, and I fixed the prototype against the same files. A pass on it would not predict real-world results. Real PDFs from Word, LaTeX, scanners and browsers will be harder.
- The prototype does not handle borderless tables, footnotes, hyperlinks, form fields or vector graphics, and it raises an unhandled error on encrypted or corrupt input (no output is produced, but a product needs friendly messages).
- No Microsoft Word was available. Validity and re-rendering used LibreOffice, which re-renders its own output and so flatters LibreOffice.
- G10 (offline) was judged from design and licence review; network traffic during conversion was not captured.
- One shared 2 vCPU machine. The round 2 prototype timings were taken while another process was using a CPU. Memory is not affected.
- The pdf2docx reference run was optional and was not done; it could not have counted toward the decision.

## Deviations from the pre-registered plan

1. The first scoring run used an internal 300 s limit for re-opening a DOCX in LibreOffice. LibreOffice's 198-page output exceeded it and was wrongly recorded as invalid. The criteria set no such limit, so the limit was raised to 1,500 s and the whole evaluation re-run once; that file now passes G9. Gate thresholds are unchanged.
2. The prototype code changed once between rounds (the four fixes above). The candidates are code, not thresholds, but this is stated because it makes the final result less independent.

## Consequences

- PDF to Word is out of the MVP. The tool page, registry mode (`SERVER`) and status (`planned`) are unchanged; no copy promises it.
- The source documents (architecture and roadmap `.docx`) should list it under V1.1. They are yours to edit; I have not changed them.
- If V1.1 revisits it, a first-party converter is the only candidate worth a spike, and it carries a long-term maintenance cost that LibreOffice does not.

## What it would take to reach GO later

1. Approve a re-baselined visual gate (for example a tolerance for small offsets or text-position agreement) and register it before measuring.
2. Build a held-out corpus of real, licensable PDFs written by other people, including Word and LaTeX exports, scans with OCR, borderless tables, footnotes and hyperlinks.
3. Close the prototype's known gaps and map failures to clear user messages.
4. Review the full dependency tree for licences (direct dependencies verified here: pdfplumber MIT, pdfminer.six MIT, python-docx MIT, pypdfium2 BSD-3-Clause/Apache-2.0).
5. Disclose the processing mode: it would run on the server, like Word to PDF, with the existing retention rules.

## Alternatives considered

| Option                                              | Result                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Ship LibreOffice output as "layout-preserving Word" | Fails editability, tables and column order; would not meet what users expect from "PDF to Word". Not recommended.                     |
| Ship the prototype now                              | Passes 9 of 10 gates on files I wrote; untested on real documents, no borderless tables or footnotes. Too risky for a launch promise. |
| Lower the thresholds until something passes         | Defeats a pre-registered gate.                                                                                                        |
| Cloud or commercial converter                       | Excluded: breaks the privacy-first rule and adds a third party.                                                                       |
| pdf2docx                                            | Excluded: GPL-3.0 on top of an AGPL dependency (PyMuPDF).                                                                             |
