# ADR-025: M5A Compress PDF — On-Device Engine, Truthful Profiles, Benchmark-Derived Limits

**Status:** Implemented under the approved M5 gate; Product Owner acceptance pending
**Date:** 2026-10-21
**Milestone:** M5A — Compress PDF
**Scope:** `packages/pdf-browser/src/compress-*.ts`, `compress.worker.ts`, `compress-client.ts`; `packages/tool-registry/src/catalog.ts`; `apps/web/components/compress-pdf/`, `apps/web/app/compress-pdf/`; matching tests; `apps/web/benchmarks/run-compress-pdf.mjs`; `tests/fixtures/{generate,evaluate}_compress_benchmark.py`; `docs/benchmarks/M5A-*`.

## Context

SRS FR-CMP-001..004 ask for: original and output size with percentage reduction, a safe default profile, disclosure of the quality trade-off, and no success claim when the output is not smaller. The architecture matrix listed Compress PDF as **HYBRID**. Governance forbids AGPL engines (Ghostscript, PyMuPDF) and requires numeric limits to come from real benchmarks.

The measurement that decided the design (prototype corpus, same generators as the final one): a lossless server-side pass with qpdf (the only permissively licensed server option) saved **0%** on every photo and scan file (B01, B02, C01, C02) and only helped files whose producer left streams uncompressed (A01 66%, A03 54%). Recompressing the images saved 82–96% on the same files. Value comes from images, not from structure.

## Decisions

### 1. Processing mode changes from HYBRID to LOCAL (flag for the Product Owner)

The engine runs entirely in a dedicated browser worker using dependencies that are already reviewed: `pdf-lib@1.17.1`, `fflate@0.8.3` and the browser's own `createImageBitmap` / `OffscreenCanvas`. **No new dependency.** No upload, no server job, no retention question. Because the best available server engine would add upload and retention cost without extra capability, the reason for HYBRID no longer exists. The registry, privacy label ("Processed on your device"), page copy and network behaviour all agree (E2E asserts same-origin GET only).

This changes a documented matrix entry. The architecture document (`04_…docx`) still says HYBRID; this ADR is the record of the change and it needs the Product Owner's confirmation.

### 2. What Compress does, and does not do

- **Lossy, images only.** Large images are resampled to the profile's resolution and re-encoded as JPEG. Text, fonts, vector drawings and page layout are not modified.
- **Lossless repack.** Flate streams are re-deflated at level 9, unfiltered streams are compressed, and the file is re-saved with object streams.
- **Not done:** font subsetting, duplicate-object merging, garbage collection of orphaned objects, CMYK/Indexed/mask image recompression, JBIG2/JPX handling, PDF/A preservation, linearization (a re-saved file is not linearized).

### 3. Profiles (truthful, fixed numbers)

| Profile                | Target resolution | JPEG quality | UI summary                        |
| ---------------------- | ----------------- | ------------ | --------------------------------- |
| Light                  | 220 dpi           | 85           | Best quality, smaller saving      |
| **Balanced** (default) | 150 dpi           | 75           | Recommended for email and screens |
| Strong                 | 110 dpi           | 60           | Smallest file, softer images      |

An image is resampled only if its effective resolution is more than 1.25× the target. An unresized JPEG is re-encoded only if its estimated quality exceeds the target by more than 8 points. A re-encoded image replaces the original only if it is at least 10% smaller. The output is published only if it is at least 1% smaller than the input; otherwise the outcome is **no reduction** and no file or download link exists.

### 4. Safety rules for images (never change what cannot be changed safely)

An image is left exactly as it is when any of these holds:

- it has a soft mask, stencil mask, colour-key mask, `/Decode` array, non-8-bit depth, or a colour space other than DeviceGray, DeviceRGB or 3-component ICCBased (CMYK, Indexed, Cal\*, Lab, Separation, 1-component ICC are skipped);
- it uses a filter other than DCTDecode, Flate or none;
- its EXIF orientation is not 1, or its JPEG header disagrees with the image dictionary;
- it is a flat graphic (at least 50% identical horizontal neighbours in a centre crop): screenshots and diagrams stay lossless;
- it is also used somewhere the page scanner did not visit (forms, annotations, patterns, Type 3 glyphs, or an unreachable object): **an image is resized only if every reachable referrer dictionary was visited**, so no displayed size can be wrong;
- page layout cannot be established (`UserUnit` ≠ 1, scan budget exhausted, undecodable content stream, form cycle, depth > 8): no image is resized and the result says so;
- it is over a decode cap or the image-time budget is exhausted.

Grayscale images are re-encoded as RGB JPEG (a DeviceRGB dictionary replaces DeviceGray). The image dictionary is edited in place, preserving optional-content, structure-parent, `/Interpolate` and `/Intent` keys.

### 5. Lossless pass and a pdf-lib finding

**Finding.** When a stream's `/Length` is an indirect reference and the stream data runs straight into `endstream` with no separate end-of-line, pdf-lib 1.17's fallback end-of-stream search treats a trailing `0x0A`/`0x0D` _data_ byte as the line ending and trims it. For a Flate stream the last bytes are the Adler-32 checksum, so a stream loaded by pdf-lib can lose one or two checksum bytes. The compressed data itself is intact.

**Handling in Compress.** The engine inflates the raw deflate data (skipping the 2-byte zlib header), classifies the trailer as _valid_, _truncated_ (the lost bytes can only have been line-ending bytes) or _invalid_ (stream skipped), and rewrites truncated streams with a correct trailer. Unit tests reproduce the trimming with an indirect `/Length`.

**Impact elsewhere (resolved).** Merge, the page tools, Split and Remove metadata could emit the same truncated checksums. A shared first-party repair for those tools shipped separately in [ADR-026](026-pdf-lib-trailer-repair.md) (PR #19, merged). Compress keeps its own, more general repair described above.

### 6. Verification before anything is offered

After saving, the engine reopens its own output and checks: `%PDF-` header, page count, MediaBox and rotation of every page, that every touched stream has the expected length, and that replaced JPEG streams start with `FFD8`. Any mismatch is `OUTPUT_INVALID` and no file is created. Cancel aborts at the next checkpoint and terminates the worker. The independent benchmark checks (qpdf, pdfium, text comparison) are in `docs/benchmarks/M5A-compress-pdf.md`.

### 7. Limits: evidence and decisions

All values were measured on desktop Chromium on a shared 2-vCPU VM through the production page. They were **confirmed, not changed**, by the benchmark; no provisional number was raised.

| Limit                       | Value                             | Evidence                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Max input                   | **50 MiB**                        | 47.6 MB / 190 pages: 6.9 s, 348 MiB peak. 46.7 MB with a 31.5 MP raster: 3.9 s, 558 MiB peak.                                                                                                                                   |
| Max pages                   | **1,000**                         | 1,000 text pages: 1.4 s, 167 MiB. 1,000 pages with 1,000 images that were already at target: 1.4 s, 251 MiB (no image re-encoded, no reduction).                                                                                |
| Max output                  | **50 MiB**                        | A file is published only if smaller than its input, so output ≤ input ≤ 50 MiB; the cap is a safety valve.                                                                                                                      |
| JPEG decode cap (per image) | **64 MP**                         | An 8000×8000 JPEG succeeded: 1.9 s, 636 MiB (largest memory measured). A 100 MP JPEG is skipped in 0.2 s.                                                                                                                       |
| Raster (Flate) decode cap   | **32 MP**                         | A 31.5 MP image succeeded: 3.9 s, 558 MiB. A 40 MP image is skipped (2.9 s, 370 MiB, spent in the lossless pass).                                                                                                               |
| Images considered           | **1,000**, largest first          | Re-encoding was measured with 150 and 190 images (5.9 s and 6.9 s). 1,000 images were scanned (1.4 s) but all were already at target, so 1,000 re-encodes were **not** measured; the 60 s time budget is what bounds that case. |
| Image-pass time budget      | **60 s**                          | Largest measured image pass is about 7 s (190 images), so about 8× margin. Slower devices leave remaining images unchanged and say so.                                                                                          |
| Inflate budget              | 128 MiB per stream, 768 MiB total | Decompression-bomb guard; the largest legitimate stream measured is 120 MB (40 MP RGB).                                                                                                                                         |
| Content-scan budget         | 128 MiB                           | **Not independently stress-tested**; bounded by input size and the inflate budget.                                                                                                                                              |
| Output canvas               | 16 MP                             | Platform limit (Safari canvas), not a measurement.                                                                                                                                                                              |

**Not measured, and why it matters.** There was no phone, Safari or Firefox here. Peak memory of 558–636 MiB on a desktop does not show that a low-memory phone survives a 64 MP decode; a tab killed for memory cannot be caught by the engine. Browser decode failures that _can_ be caught are reported as "could not be read safely". Mobile and cross-browser validation is a launch gate (M7/M8). If the Product Owner prefers a conservative public cap before then, lowering the JPEG decode cap to 48 MP is a one-line registry change.

### 8. The UI says only what is true

- The default view states, before any file is chosen, that compression changes images only and loses some detail, and that some PDFs cannot be reduced. No "up to X%" or "lossless" claim appears.
- The result shows original and new size, `NN% smaller` (capped at 99%), strength used, how many images were changed, and counts of images left unchanged grouped by reason.
- **No reduction** creates no download and says what was left unchanged and why. (The first draft said "already well compressed"; the benchmark showed that was false for an image over the size limit, so the wording is neutral and reason-based.)
- Warnings are shown when they apply: digital signature will no longer validate; PDF/A conformance may be lost; images could not be resized in this browser; layout could not be analysed so images were kept.
- The output name is fixed (`compressed.pdf`); the source filename never reaches a download, announcement, log or Blob type. Object URLs are revoked on Start over, Try a different strength, choosing a new file and leaving the page.

### 9. Privacy

All work happens in a dedicated worker on the device. No document content, filename, size or image data is sent anywhere or logged. Requests observed across the whole benchmark were same-origin GETs only (counts in the benchmark file). The engine is a separate worker chunk requested only when Compress starts.

## Consequences

- Compress PDF is available as LOCAL; the tool count rises to eleven.
- Photo- and scan-heavy PDFs shrink substantially; text-only and already-optimized PDFs often cannot, and are reported honestly.
- Image quality loss at Balanced is small in the measured sample (worst sampled 100 dpi SSIM 0.956; Strong 0.939) and clearly disclosed.
- A Safari/Firefox/mobile memory gate remains open.

## Not done (deferred, with reasons)

- Safari, Firefox and phone validation (no devices here): M7/M8 gate.
- Garbage collection of unreferenced objects and duplicate-image merging: needs a safe reachability pass over the whole object graph; separate spike.
- CMYK/Indexed/masked image recompression: needs colour management and mask handling; the safe default is to leave them.
- Fixing the pdf-lib trailing-byte trimming in other tools: done in ADR-026 (see §5).

## Unresolved decisions for the Product Owner

1. Confirm HYBRID → LOCAL for Compress PDF (architecture document needs the matching edit).
2. Accept the desktop-measured limits for launch preview, or request a lower public JPEG decode cap until a phone has been tested.
3. The M4 retention default (A 15 min / B 10 min / C 5 min) is still pending and unchanged.
