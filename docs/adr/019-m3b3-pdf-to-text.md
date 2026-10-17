# ADR-019: M3B.3 local PDF to Text

## Status

Implemented under the approved M3B.3 scope; owner acceptance pending.

## Context

M3B.3 requires a `LOCAL` PDF to Text workflow (`FR-TXT-001`–`FR-TXT-004`) that reuses the existing PDF.js preview document, assembles plain text in natural source order, offers Copy and Download, and honestly discloses when no meaningful text layer is present. Documents, extracted text, source filenames and page content must stay inside the browser.

## Decision

- Extend the existing `PreviewDocument` with a single new method `extractText(sourcePageNumber, { signal })` returning a `TextExtractionResult` of raw per-page text. The same loaded document, single native PDF.js worker and allowlisted first-party assets back preview, rendering and extraction. No second PDF loader, parser, worker or session architecture is introduced. React never receives raw PDF.js objects.
- Author a small orchestrator `packages/pdf-browser/src/pdf-to-text.ts` whose public API is `extractPdfText(preview, plan, limits, options)`. It walks the page plan in source order, calls `extractText` per page, applies the character and UTF-8 byte caps running and after assembly, enforces cancellation at page boundaries and classifies each page as meaningful or not.
- Use `page.getTextContent({ includeMarkedContent: false, disableNormalization: false })` and walk `content.items` in natural order. For each item append `item.str` and, if `item.hasEOL === true`, append `\n`. Join page chunks with the constant `PAGE_SEPARATOR = "\n\n"`. No column reconstruction, no table detection, no NLP, no geometry-based reading-order engine.
- Normalise line endings to `\n` (`normalizeLineEndings`) before validation. Classify a page as "meaningful" iff it matches `/\S/u` (any non-whitespace Unicode code point). Whitespace-only pages and empty items are not meaningful.
- A whole document with zero meaningful pages returns `kind: "no-text"`, `text: ""`, and no Blob URL is created. The UI shows the honest "scanned or image-based … may require OCR" panel. OCR is explicitly out of scope for M3B. No server upload is attempted. No external OCR link is advertised.
- A partial-text document (some pages meaningful, others not) returns the valid assembled text, records `pagesWithoutText`, and the UI discloses the affected page numbers next to the preview. The workflow never fails the whole operation because of a single legitimately blank page.
- Render extracted text strictly as a React text node inside a `<pre>` element. Never use `dangerouslySetInnerHTML`, never route the text through a Markdown or HTML interpreter. The literal `<script>…</script>` fixture must display as text and must not inject a `<script>` DOM element.
- Preview is bounded to `maxPreviewCharacters` with a line-boundary slice. Copy and Download always use the complete validated extracted text. The UI exposes a visible "Preview shortened" note when truncated. No silent truncation of the full result.
- Fixed output filename `extracted-text.txt`, UTF-8 Blob, downloaded via a programmatically created `<a download>` anchor. The source filename never flows into the output name, URL, Copy payload or Blob mime type.
- Cancellation is checked at every yield point (before and after each `getTextContent` call, between pages, and before and after the final validation phase). A single `getTextContent` call cannot be interrupted mid-call; the engine therefore stops before scheduling the next page and discards any unpublished text.
- Add no production dependency. `pdf-lib`, `pdfjs-dist` and `fflate` versions are unchanged.

## Engineering limits

- Inputs: 1 file, 10 MiB input bytes, 200 pages (inherited from the shared `localPageLimits`).
- Output: 8 MiB TXT output. Maximum 2 000 000 characters, 8 MiB UTF-8 bytes.
- Preview: 100 000 characters rendered into the DOM. Larger results stay fully in-memory for Copy and Download.

These are evidence-based engineering limits, not public performance guarantees. Physical low-memory mobile verification remains a launch gate.

## Consequences

- Unit and browser tests cover one-page simple text, multi-page ordering, line endings, Unicode normalisation, blank pages, whole-document no-text, partial-text documents, corrupt PDFs, encrypted PDFs, cancellation, reset, source replacement, stale completion, exact UTF-8 download, fixed filename, malicious-looking literal text, bounded DOM preview, Copy preserving the full result, context-wide request allowlists, and keyboard-complete journeys.
- The three new synthetic fixtures `text-xss.pdf`, `text-partial.pdf` and `text-scanned.pdf` are authored by `tests/fixtures/generate_text_fixtures.py` using the already available `reportlab`/`pypdf`/`Pillow` utilities. Their SHA-256 hashes are recorded in `tests/fixtures/pdf/text-manifest.json`. The existing `preview-features.pdf` provides the embedded-font Unicode case.
- The product tool does not promise:
  - perfect reconstruction of visual PDF layout, column order, tables or hidden text;
  - OCR for scanned/image-only PDFs;
  - cancellation inside a single `getTextContent` call (document limitation; the engine stops before the next page);
  - byte-identical outputs across browser engines (though extraction is deterministic for a given PDF.js version).

## References

- SRS: `FR-TXT-001`, `FR-TXT-002`, `FR-TXT-003`, `FR-TXT-004`, `FR-GEN-004`, `FR-GEN-009`, `FR-PRV-001`, `FR-PRV-005`, `FR-PRV-006`, `NFR-A11Y-001` through `NFR-A11Y-006`.
- Architecture: `04 §3`, `04 §4`, `04 §16` (ADR-004 PDF.js reuse).
- Prior ADRs: ADR-013 (preview foundation, scheduler, font licence posture) and ADR-018 (per-page bounded operation on the same `PreviewDocument`).
