# M5A Milestone Report: Compress PDF

**Date:** 2026-10-21
**Status:** Implementation complete; awaiting Product Owner acceptance. Not merged.
**Preceding milestone:** M4D — Verification & Closeout (accepted and merged, `9ca7c14`).
**Decision record:** [ADR-025](../adr/025-m5a-compress-pdf.md). **Evidence:** [`M5A-compress-pdf.md`](../benchmarks/M5A-compress-pdf.md), [`M5A-compress-pdf-results.json`](../benchmarks/M5A-compress-pdf-results.json), [`M5A-compress-pdf-evaluation.json`](../benchmarks/M5A-compress-pdf-evaluation.json).

## Summary

Compress PDF now works fully on the device, with no upload and no new dependency. It resizes and re-saves large images, repacks the document data, verifies its own output, and only offers a download if the file is really smaller. In 57 runs through the production page, all 46 compressed outputs passed qpdf, kept their page count and extracted text, and the 9 PDFs that could not be made smaller correctly produced no file (the other 2 runs were the expected encrypted and corrupt errors).

## What was implemented

- **Engine** (`packages/pdf-browser`): image planning and safe recompression, lossless stream repack with repair of a pdf-lib truncation bug, post-save verification, worker and client with cancel.
- **Page** `/compress-pdf`: strength choice (Light / **Balanced** / Strong), progress, cancel, result with sizes and percentage, what was left unchanged and why, warnings, fixed download name `compressed.pdf`, "Try a different strength".
- **Registry:** Compress PDF is **LOCAL, available**; tool count copy is now "Eleven".
- **Benchmark tooling:** corpus generator, production-page harness, independent evaluator, summarizer.

## Decisions (details in ADR-025)

1. **HYBRID → LOCAL.** The best permissive server engine (qpdf, lossless only) saved 0% on photo/scan PDFs; the value is in images, which the browser can do. Needs your confirmation (see below).
2. **Image-only lossy changes**; text, fonts, vectors and layout untouched. Screenshots/diagrams stay lossless; masks, CMYK, odd colour spaces, rotated-by-EXIF images and shared images are never touched.
3. **Profiles:** Light 220 dpi / q85, Balanced 150 / q75 (default), Strong 110 / q60.
4. **No file when not smaller** (under 1% saving). The wording says what was left unchanged and why.

## Measured results (summary)

Desktop Chromium, 2 vCPU VM, production build. Full tables in the benchmark doc.

- Photo and scan PDFs (4 files): **Balanced 85–96% smaller** (Light 52–90%, Strong 92–98.5%) in 0.8–1.9 s.
- Text-only: 53–66% saved only in the synthetic files whose producer left streams uncompressed; an already-optimized text PDF and a bilevel scan: **no file** (all three profiles).
- Screenshots: 10.7% (kept lossless on purpose).
- Largest input 47.6 MB / 190 pages: 16% smaller in 6.9 s, 348 MiB peak. 1,000 text pages: 1.4 s. 1,000 pages with images: 1.4 s, no reduction. 64 MP JPEG: 1.9 s, 636 MiB peak (highest memory seen).
- Worst sampled quality: SSIM 0.956 at Balanced, 0.939 at Strong (100 dpi).
- Privacy audit, 57 runs / 1,611 requests: 0 cross-origin, 0 non-GET, 0 WebSockets, 0 console or page errors.

## Limits decided

No provisional limit was changed. All were **confirmed by measurement except two caveats** (below): 50 MiB input and output, 1,000 pages, 64 MP per JPEG, 32 MP per raster, 1,000 images considered, 60 s image budget. Evidence table in ADR-025 §7. These are desktop-only figures. Caveats: re-encoding was measured with 150–190 images, not 1,000 (the 60 s time budget bounds that case), and the content-scan budget was not stress-tested on its own.

## Verification

- Unit: 265 (pdf-browser, incl. the engine) + 133 (web) tests pass.
- Format, lint (0 warnings), typecheck, production build: clean.
- Playwright: full run in progress when this draft was committed; result is added below before the PR is opened.
- Independent checks of every benchmark output: qpdf, pdfium SSIM, text comparison.
- **Pre-existing failures in this container:** 7 older E2E tests (organize, extract/delete/rotate, split source-replacement; PDF to JPG) fail on untouched `main` (`9ca7c14`) too, so they are not caused by M5A. They report an encrypted PDF as "damaged" and PDF to JPG as "did not finish" in the preview module. CI (Node 24) should be checked; I did not change that code.

## Security and privacy

No upload, no server call, no new dependency (AGPL engines still excluded). Work runs in a dedicated worker. No document content, filename or size is logged. The download name is fixed. Object URLs are revoked on Start over, strength change, new file and leaving the page. Decompression is bounded per stream and in total; the output is re-opened and checked before it is offered.

## Known limitations (honest list)

- **Safari, Firefox and phones were not tested.** A low-memory device could run out of memory on a very large photo; the engine cannot catch a killed tab. Launch gate for M7/M8.
- The synthetic photo corpus is noisier than typical files; real savings will vary, and some PDFs cannot be reduced.
- Quality loss at Strong is visible on scans (worst 200 dpi SSIM 0.894); it is labelled "softer images".
- Not done: font subsetting, duplicate or orphan object removal, CMYK/Indexed/masked image recompression, PDF/A preservation, linearization.

## Finding outside this milestone

pdf-lib 1.17 can trim one or two trailing Flate checksum bytes when `/Length` is an indirect reference. Compress detects and repairs it. **Other tools that re-save PDFs through pdf-lib (merge, split, organize, page tools, metadata removal) may produce the same truncated streams.** Not fixed here; proposed for M7.

## Deviations from plan

- Compress moved from HYBRID to LOCAL (approval requested below).
- The first no-result wording ("already well compressed") was wrong for oversize images; it was found by the benchmark and replaced with reason-based text.

## Decisions needed from the Product Owner

1. **Confirm HYBRID → LOCAL** for Compress PDF (the architecture document needs the matching edit).
2. **Limits:** accept the desktop-measured caps for the preview, or ask for a lower public JPEG cap (for example 48 MP) until a phone has been tested.
3. **pdf-lib truncation:** approve investigating the other tools in M7.
4. **Still pending from M4:** retention default (A 15 min / B 10 min / C 5 min); the default stays 15 min until you choose.

## Manual acceptance script

1. Open `/tools`: Compress PDF says Available and "Processed on your device". Open `/compress-pdf`: the note says images only change and some PDFs cannot be reduced.
2. Choose a PDF with big photos or scans. Balanced is preselected. Click Compress PDF; Cancel mid-way once and confirm you return to the strength choice.
3. Run it to the end: check "NN% smaller · A → B", download `compressed.pdf`, and open both files side by side. Zoom into a photo and a page of text.
4. Click Try a different strength → Strong (smaller, softer) and Light (larger, sharper).
5. Choose a plain text PDF made by a modern app, or a scan already at low resolution: expect "This PDF could not be made smaller" and **no** download link.
6. Choose a password-protected PDF and a broken file: expect clear messages.
7. With DevTools → Network open, run step 3: only same-origin GET requests, no document data.
8. **On your phone:** open the page and compress a large photo PDF. Tell me whether it finishes, is slow, or the tab reloads — this is the one thing I could not test.
9. A digitally signed PDF shows the signature warning.

## Files

- `packages/pdf-browser/src/compress-*.ts`, `compress.worker.ts`, `compress-client.ts`; `package.json` export `./compress`; tests under `packages/pdf-browser/tests/compress-*.test.ts` and `tests/helpers/compress-fixtures.ts`.
- `packages/tool-registry/src/catalog.ts` (Compress PDF now LOCAL, available, limits).
- `apps/web/app/compress-pdf/page.tsx`, `apps/web/components/compress-pdf/{session.ts,compress-pdf-workspace.tsx}`, `app/globals.css`; tool-count copy in several pages; tests `tests/compress-pdf-session.test.ts`, `e2e/compress-pdf.spec.ts`, updated registry/page/shell tests.
- `apps/web/benchmarks/run-compress-pdf.mjs`; `tests/fixtures/{generate,evaluate,summarize}_compress_benchmark.py`.
- `docs/adr/025-m5a-compress-pdf.md`, `docs/benchmarks/M5A-*`, README, ADR index, governance table, dependency review.

## Recommended next milestone

**M5B — PDF→Word fidelity benchmark with an explicit GO/DEFER decision** (no build unless GO). I will not start it until you accept M5A.
