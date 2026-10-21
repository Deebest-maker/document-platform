# M5B PDF to Word: pre-registered criteria

**Committed before any measurement.** The thresholds below were fixed first so they cannot be tuned to the results. Any later change is recorded in the report as a deviation, with the reason.

## Why this exists

- SRS FR-P2W-001..004: attempt DOCX conversion, disclose that fidelity varies, offer the DOCX, and never present scanned or image-only PDFs as editable text unless OCR was performed.
- Architecture section 15 and QA strategy: benchmark representative documents first; if quality is unacceptable, PDF to Word moves to V1.1 rather than shipping a poor tool.
- Governance: numbers come from real benchmarks. Output of this milestone is an explicit **GO or DEFER**. Nothing is built unless it is GO.

## Licence gate (checked first, before quality)

AGPL or GPL engines are excluded from the proprietary product: PyMuPDF, Ghostscript, `pdf2docx` (GPL-3.0, built on PyMuPDF), poppler `pdftohtml`. Cloud or commercial conversion APIs are excluded by the privacy posture (the document would leave our infrastructure). Eligible candidates need permissive or file-level open-source terms and must run offline.

**Eligible candidates**

- **A. LibreOffice** PDF import (`writer_pdf_import`) exported to DOCX. Already in the hardened processor container (MPL 2.0).
- **B. First-party prototype**: `pdfplumber` / `pdfminer.six` (MIT) layout analysis feeding `python-docx` (MIT). Shows what we could build ourselves on permissive parts. Lives in benchmark tooling only.

`pdf2docx` may be run as a **reference ceiling only**. It is not eligible and never counts toward the decision.

## Corpus (synthetic, no user data)

Ground truth comes from the generator, not from any candidate. Three producers are used so the result is not tied to one PDF writer: LibreOffice, Chromium and ReportLab.

| Class | Files                                                                                                                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Everyday documents: prose with headings, lists and emphasis; a report with header, footer and page numbers; an invoice with a line-item table; a multi-page data table with repeating header row; text with inline images and captions. |
| B     | Complex layout: two-column article, three-column newsletter with sidebar, slide-style export, form-like page, text wrapped around an image, a right-to-left (Arabic) page.                                                              |
| C     | No text layer: a scanned (image-only) document; a scanned document with an invisible OCR text layer.                                                                                                                                    |
| D     | Operational: 50 pages, 200 pages, near the 20 MiB input limit, encrypted, corrupt.                                                                                                                                                      |

## Metrics

1. **Text integrity**: word recall and precision (multiset of normalised words, NFKC, case-folded, punctuation stripped) of the DOCX text against the generator's ground truth. Text in text boxes and tables counts.
2. **Reading order**: normalised longest-common-subsequence similarity of the word sequence against ground-truth order.
3. **Editability**: share of text characters that sit in flowing Word content (body paragraphs, table cells) rather than text boxes or frames; and fragmentation = output paragraphs divided by ground-truth paragraphs on prose files.
4. **Tables**: ground-truth tables recovered as real Word tables, and the share of cells whose text lands in the right row and column.
5. **Images**: embedded images in the DOCX against ground truth.
6. **Visual similarity**: DOCX re-rendered to PDF (LibreOffice), page count compared, per-page SSIM at 72 dpi against the original. Known limit: LibreOffice re-renders its own output, and Word is not available here; SSIM also penalises legitimate reflow, so it is a coarse check.
7. **Scanned handling**: pages with no text layer must be detected (pdfium character count of zero) and must not be presented as editable; text-layer pages must not be flagged.
8. **Operational**: wall time, peak resident memory, and clean failure (non-zero exit or no output, within the time limit) for encrypted and corrupt input.
9. **Output validity**: every produced DOCX opens in `python-docx` and converts back to PDF in LibreOffice.

## Gates (all must hold for one eligible candidate to be GO)

| Gate | Requirement                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | Text integrity: every Class A file recall >= 99% and precision >= 98%; every Class B file recall >= 97%; no file below 95%.                                                           |
| G2   | Reading order: every Class A file >= 98%; every Class B file >= 90%.                                                                                                                  |
| G3   | Editability (Class A): >= 90% of text characters in flowing content and fragmentation <= 1.5 on prose files. Class B is reported, not gated (FR-P2W-002 requires disclosure instead). |
| G4   | Tables (invoice and data table): >= 80% of ground-truth tables recovered as real Word tables with >= 90% of cells correct.                                                            |
| G5   | Images (Class A): every ground-truth image present in the DOCX.                                                                                                                       |
| G6   | Visual (Class A): page count within +-15% (at least +-1 page) on every file, and median SSIM >= 0.70 across Class A pages.                                                            |
| G7   | Scanned: 100% of no-text pages detected, 0 false detections, and no fabricated text in the output for those pages.                                                                    |
| G8   | Operational: 50 pages <= 60 s, 200 pages <= 120 s (the processor's runner timeout), peak memory <= 1 GiB, encrypted and corrupt input fail cleanly within 10 s.                       |
| G9   | Validity: 100% of produced DOCX files pass the validity check.                                                                                                                        |
| G10  | Licence and offline: all runtime components permissive, no network use during conversion.                                                                                             |

## Decision rule

- **GO**: at least one eligible candidate passes every gate. The report states exactly which document classes were gated, and the product copy must stay within them.
- **DEFER**: otherwise. PDF to Word moves to V1.1 as the architecture document directs. The report lists the failed gates and what it would take to pass them.
- No third outcome. A "narrow GO" is only a GO whose scope is the classes above.
- If a gate cannot be measured, that is reported as not run and the decision is DEFER for that reason.

## Known limits of the evidence (stated in advance)

Synthetic corpus; one machine (2 vCPU, shared VM); LibreOffice 24.2.7; fonts available here (DejaVu, Liberation-compatible, Carlito, Inter); no Microsoft Word to open the output. Real-world PDFs from other producers may behave differently.
