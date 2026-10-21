# ADR-026: Repair Flate checksum bytes trimmed by pdf-lib

**Status:** Implemented as a small follow-up to M5A; accepted and merged
**Date:** 2026-10-21
**Scope:** `packages/pdf-browser/src/stream-repair.ts`; call sites in `merge.ts`, `page-operations.ts` (page tools and Split) and `metadata-removal.ts`; `packages/pdf-browser/tests/stream-repair.test.ts`.
**Relates to:** ADR-025 (found there, section 5; the Compress engine has its own repair).

## Context

pdf-lib 1.17.1 (the latest release; the maintained fork `@cantoo/pdf-lib` 2.11.1 behaves the same) finds the end of a stream by searching for `endstream` when `/Length` is an indirect reference. If the data runs straight into `endstream` with no end-of-line marker, a final LF, CR or CR LF **data** byte is taken for the marker and dropped. A Flate stream ends with its Adler-32 checksum, so it can lose its last one or two bytes.

Checked against the loaders we use: the loss survives load and save, Merge's `copyPages`, and the page tools. Conforming files (an end-of-line before `endstream`) and files with a direct `/Length` are not affected. Impact is a validator warning (qpdf) while pdfium still renders; it is a latent defect, not a rendering failure. How common such PDFs are in the wild is unknown.

## Decision

After each `PDFDocument.load`, run a first-party repair on the loaded document. It is deliberately narrow:

- Only a stream whose declared `/Length` (direct, or an indirect reference to a number) is exactly **1 or 2 bytes longer** than the loaded data is a candidate. This is a length comparison; nothing is inflated otherwise.
- The first filter must be FlateDecode and the data must have a plain zlib header.
- The deflate data is inflated with a bound (256 MiB total per document, nothing is kept) to compute the real checksum. The stream is rewritten only if the checksum bytes that survived match its start **and** the missing bytes are exactly what the trimming rule can remove (LF, CR, or CR LF). The checksum identifies the missing bytes, so nothing is guessed.
- Anything else is left unchanged. Non-Flate streams that lose a byte are not repaired (the byte cannot be known; readers tolerate it, as today).
- The repair never throws and never changes pages, resources or metadata.

It runs in Merge, the shared page loader (organize, extract, delete, rotate, Split) and Remove metadata. Images to PDF never loads an existing PDF. Compress keeps its own, more general repair from ADR-025.

## Alternatives considered

| Option                             | Result                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Switch to `@cantoo/pdf-lib`        | Tested: same bug. Large dependency change for no gain.                                                             |
| Patch pdf-lib (`pnpm patch`)       | Fixes the root but adds patch tooling we do not have, and must be redone on every upgrade. Fallback if this fails. |
| Do nothing                         | Leaves a known damaged-output case.                                                                                |
| Inflate every Flate stream on load | Exact but costs CPU and memory on every large file for a rare case.                                                |

## Consequences

- No new dependency. `fflate@0.8.3` is already a dependency; its streaming `Inflate` is imported dynamically **only when a candidate stream exists**. A first version imported it statically, and the Split browser test "one range group downloads a PDF without loading archive code" caught the archive chunk being requested for ordinary files.
- The `adler32` loop is duplicated from the Compress engine (about ten lines); a later cleanup can make Compress use this module.
- Not covered: a damaged object stream or cross-reference stream fails when pdf-lib opens the file, before any repair can run. Behaviour is unchanged.
- Not measured: how often real-world PDFs hit this. The fix costs one length comparison per stream.
