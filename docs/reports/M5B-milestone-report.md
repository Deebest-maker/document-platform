# M5B Milestone Report: PDF to Word fidelity benchmark

**Date:** 2026-10-21
**Status:** Benchmark complete; decision **DEFER**; accepted by the Product Owner and merged (`20ac497`).
**Preceding milestone:** M5A — Compress PDF (accepted and merged, `d8bd7f9`).
**Decision record:** [ADR-027](../adr/027-m5b-pdf-to-word-defer.md). **Criteria (fixed before measuring):** [`M5B-pdf-to-word-criteria.md`](../benchmarks/M5B-pdf-to-word-criteria.md). **Evidence:** [`M5B-pdf-to-word.md`](../benchmarks/M5B-pdf-to-word.md), [`M5B-pdf-to-word-results.json`](../benchmarks/M5B-pdf-to-word-results.json), [`M5B-pdf-to-word-evaluation.json`](../benchmarks/M5B-pdf-to-word-evaluation.json), plus the untouched first round (`*-round1.json`).

## Summary

I tested whether PDF to Word can reach acceptable fidelity with tools our licence rules allow, using 19 synthetic PDFs and 10 gates written down before any measurement. **No candidate passed every gate, so PDF to Word moves to V1.1 and nothing was built.**

- **LibreOffice** keeps every word (recall 100%) but writes one text box per line, no real tables and wrong column order. It fails five gates: reading order, editability, tables, operational, and the visual one.
- **A first-party prototype I built for the test** is editable and, after one round of fixes, passes 9 of 10 gates. It fails only the visual gate, which turns out to be miscalibrated: moving a page by one point (0.35 mm) already scores below its threshold. By the rule we agreed, that is still DEFER.
- The prototype was tested on files I wrote, so its pass is weak evidence. I do not recommend shipping it on this result.

## What was implemented

- **Criteria** (committed first): corpus classes, nine metrics, ten gates and a decision rule with no third outcome.
- **Corpus generator** (`generate_p2w_benchmark.py`): 19 PDFs with ground truth: 6 everyday documents (prose, emphasis and lists, a report with headers and footers, invoice tables, a 3-page data table, images with captions), 6 complex layouts (two columns, three columns with sidebar, slides, a form, text around an image, Arabic right-to-left), 2 with no text layer (a scan, and a scan with an invisible OCR layer), and 5 operational cases (50 pages, 198 pages, 19.9 MB, encrypted, corrupt).
- **Runner** (`run_p2w_benchmark.py`): converts with each candidate and records time and peak memory of the whole process tree.
- **Independent evaluator** (`evaluate_p2w_benchmark.py`): scores the DOCX files with tools that are not part of either candidate, applies the gates, and writes the results table.
- **Prototype** (`p2w_prototype.py`): benchmark tooling only, not product code.

## Decision (details in ADR-027)

| Gate                 | LibreOffice | Prototype |
| -------------------- | ----------- | --------- |
| G1 Text integrity    | pass        | pass      |
| G2 Reading order     | **fail**    | pass      |
| G3 Editability       | **fail**    | pass      |
| G4 Tables            | **fail**    | pass      |
| G5 Images            | pass        | pass      |
| G6 Visual similarity | **fail**    | **fail**  |
| G7 Scanned handling  | pass        | pass      |
| G8 Operational       | **fail**    | pass      |
| G9 Validity          | pass        | pass      |
| G10 Licence, offline | pass        | pass      |

## Measured results (summary)

- **LibreOffice:** recall 100% and precision 99.4% or better on every file with text; reading order 53.6% (two columns) and 36.6% (three columns with sidebar); 96 text boxes for 96 lines on the first test file and 7,885 for the 198-page file; 0 of 3 tables recovered; 50 pages in 6.5 s, 198 pages in 61.8 s, peak 615 MiB; a truncated PDF exits 0 and yields a DOCX whose only content is a misleading error sentence; re-opening its own 198-page output took 462 s.
- **Prototype, first round:** failed 5 gates because of four defects (a dropped table, unreadable Arabic, interleaved columns, memory of 1,330 MiB).
- **Prototype, final:** recall and precision 100%, order 97.9% or better, all text in flowing paragraphs, 3 of 3 tables, 3 of 3 images, scans detected with no invented text, 24.3 s and 114 MiB for 198 pages. Peak memory over the whole set is 142 MiB.
- **Visual gate:** median SSIM 0.579 (LibreOffice) and 0.574 (prototype). A one-point page shift scores 0.698 and two points 0.638, so the 0.70 threshold cannot tell good layout from poor.

## Verification

- All 40 figures cited in this report and in ADR-027 were checked against the raw result files by script; none differed.
- The first full conversion and scoring round is kept unchanged. The prototype changed once afterwards; the committed prototype was re-run on all 17 convertible files and produces byte-identical Word body XML and the same image sizes as the measured outputs.
- No product code changed, so the web and processor test suites are unaffected. The pull request runs the full CI pipeline (format, lint, types, tests, build, end-to-end, dependency audit).
- Not run: the optional pdf2docx reference (it could not count toward the decision), Microsoft Word, real-world PDFs.

## Security and privacy

- Benchmark inputs are synthetic files generated by the scripts; no user document was used.
- Nothing was added to the product: no dependency, endpoint, tool page, storage or analytics. The prototype's libraries live only in a git-ignored local environment.
- Direct dependencies of the prototype are permissive (pdfplumber MIT, pdfminer.six MIT, python-docx MIT, pypdfium2 BSD-3-Clause/Apache-2.0); no AGPL or GPL tool counted toward the decision. The full dependency tree was not reviewed because nothing is shipping.
- Offline operation was judged from design, not captured on the network.
- Finding for any future server use of LibreOffice import: it signals a corrupt PDF with a success exit code, so the PDF must be validated first.

## Known limitations (honest list)

1. Synthetic corpus; I wrote the corpus and the prototype and fixed the prototype against the same files.
2. No Microsoft Word. Re-rendering and validity checks used LibreOffice, which favours its own output.
3. The prototype handles no borderless tables, footnotes, hyperlinks, form fields or vector graphics, and fails on encrypted or corrupt input with an unhandled error.
4. One shared 2 vCPU machine; the final prototype timings were taken while another process used a CPU (memory is unaffected).
5. G6 as written is miscalibrated (see above); it decided the outcome because the rule was fixed in advance.

## Deviations from plan

1. The first scoring used a 300 s limit for re-opening a DOCX in LibreOffice and wrongly recorded the 198-page output as invalid. The criteria set no such limit, so it was raised to 1,500 s and the whole scoring re-run. Thresholds are unchanged.
2. The prototype was fixed once between rounds (four defects). Both rounds are kept.

## Decisions needed from the Product Owner

1. **Accept DEFER** (recommended): PDF to Word moves to V1.1; the tool stays `planned`; no MVP copy promises it. **Accepted; the source `.docx` files were updated in a follow-up PR.**
2. **Or authorise a V1.1 spike** with a re-baselined visual gate and a held-out real-world corpus, accepting that a first-party converter has a long-term maintenance cost. ADR-027 lists what a GO would need.
3. **Still open from earlier:** the Compress retention default (A/B/C); Safari, Firefox and phone testing of Compress (a launch gate for M7/M8); and the architecture `.docx` said Compress is HYBRID although ADR-025 made it LOCAL (fixed in the follow-up PR).

## Files

- `docs/adr/027-m5b-pdf-to-word-defer.md`; ADR index; statuses of ADR-025 and ADR-026 and the M5A report updated to "accepted and merged"; governance table M5 row.
- `docs/benchmarks/M5B-pdf-to-word-criteria.md` (committed before measuring), `M5B-pdf-to-word.md`, `M5B-pdf-to-word-results.json`, `M5B-pdf-to-word-evaluation.json`, and the `-round1` copies of both JSON files.
- `tests/fixtures/{generate,run,evaluate}_p2w_benchmark.py`, `tests/fixtures/p2w_prototype.py`.

## Recommended next milestone

**M6 — Content/SEO**, once you accept M5B. M5 would then be complete. I will not start it until you say so.
