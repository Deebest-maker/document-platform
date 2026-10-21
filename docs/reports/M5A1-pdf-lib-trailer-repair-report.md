# M5A.1 Report: pdf-lib checksum-byte repair

**Date:** 2026-10-21
**Status:** Implemented; awaiting Product Owner acceptance. Small follow-up to M5A, on its own branch from `main`. Not merged.
**Decision record:** [ADR-026](../adr/026-pdf-lib-trailer-repair.md). Found in [ADR-025](../adr/025-m5a-compress-pdf.md) section 5.

## Summary

pdf-lib 1.17.1 can drop the last one or two bytes (the Flate checksum) of a stream when it loads a PDF whose stream has an indirect `/Length` and no line break before `endstream`. The loss survived into the output of Merge, the page tools and Split, and Remove metadata. A shared repair step now restores those bytes, exactly, after every load. Normal PDFs are not touched.

## What changed

- New `packages/pdf-browser/src/stream-repair.ts`. A stream is a candidate only if its declared length is exactly 1 or 2 bytes more than the loaded data and its first filter is Flate. The checksum is recomputed from the decompressed data (bounded, 256 MiB per document) and the stream is rewritten only if the surviving bytes match and the missing bytes are LF, CR or CR LF. Otherwise nothing changes.
- Called after load in Merge, the shared page loader (organize, extract, delete, rotate, Split) and Remove metadata.
- Images to PDF is not affected (it never loads an existing PDF). Compress keeps its own repair.
- No new dependency. The decoder (fflate) loads only when a damaged stream is found, so ordinary files and the single-output Split chunks do not load it. A first version loaded it always; the Split browser test "without loading archive code" caught that, and it is fixed.

## Verification

- 10 new tests: restore for LF, CR and CR LF endings; conforming and direct-length files unchanged; damaged checksum, non-Flate stream, missing zlib header and spent budget left alone; Merge, page tools and Remove metadata write the restored stream. **Without the repair, 6 of them fail.**
- Format, lint (0 warnings), typecheck clean. Unit: pdf-browser 133 and web 110 pass.
- Browser tests on the production build: merge, merge privacy, isolation, remove metadata, split, page tools and organize specs (chromium): **26 passed, 5 failed**. The 5 are the known older source-replacement tests (organize, extract/delete/rotate, split) that also fail on untouched `main` in this container; the Split "without loading archive code" test passes. Not run: the other specs and the mobile project; CI runs the full suite.
- Alternatives checked (ADR-026): the `@cantoo/pdf-lib` fork has the same bug, so switching would not help.

## Limitations

- How common these PDFs are in the wild is unknown. Impact when hit: qpdf warns, pdfium still renders.
- A damaged object stream or cross-reference stream fails when pdf-lib opens the file, before the repair can run (unchanged behaviour).
- A non-Flate stream that loses a trailing byte is not repaired (the byte cannot be known).
- Small duplication: the checksum loop also exists in the Compress engine.

## Decisions needed from the Product Owner

1. Accept this fix as is.
2. Merge order: this branch is based on `main`, so it can merge before or after M5A (#18). Both add an ADR index row, so whichever merges second needs a one-line conflict fix; I will do it.

## Files

`packages/pdf-browser/src/stream-repair.ts`, `merge.ts`, `page-operations.ts`, `metadata-removal.ts`; `packages/pdf-browser/tests/stream-repair.test.ts`; `docs/adr/026-pdf-lib-trailer-repair.md`, `docs/adr/README.md`; this report.
