# M3B.3 MILESTONE REPORT — PDF to Text

Date: 2026-10-12

Status: **IMPLEMENTATION COMPLETE — PRODUCT OWNER ACCEPTANCE PENDING.** Developed on `feat/m3b-complete-local-tools` as the first of two slices in the M3B remainder cycle (M3B.3 PDF to Text + M3B.4 Remove PDF Metadata). The Product Owner's Windows manual browser acceptance is still required before owner acceptance can be recorded; this report does not claim that acceptance.

## Implementation summary

`/pdf-to-text` provides the complete local flow: choose one PDF, validate, open the shared PDF.js preview document, extract text page by page in natural reading order, assemble deterministic plain text, display a bounded preview, Copy the full text or Download a fixed-name `extracted-text.txt`, and Start over. The registry marks `pdf-to-text` as `LOCAL` and `available`, keeps the accepted PDF type, and carries the engineering caps described below. The route stays noindex while the product remains pre-launch.

The UI exposes truthful idle, loading, extracting, ready, no-text and error states. Partial-text documents (text on some pages but not others) return the valid extracted text and clearly list the affected page numbers. A whole document with no meaningful text layer shows an honest "scanned or image-based … may require OCR" message instead of silently producing an empty download, and neither Copy nor Download is offered in that state. OCR is explicitly out of scope.

## Reuse, architecture and new code

M3B.3 reuses the M2B/M3A/M3B.1/M3B.2 foundations: the PDF.js preview document (`openPreview`), its one owned native worker, the shared validation path (`readPageInput`), stable page IDs, safe finite errors, cancellation, source-replacement/generation guards, and the first-party PDF.js assets. There is no second PDF loader, worker system, source-session architecture or document parser. No OCR, NLP, text-layout or HTML parser is introduced. React never receives raw PDF.js objects — the `extractText` boundary emits only plain text.

New code is confined to a narrow extraction layer:

- `packages/pdf-browser/src/preview/types.ts` — adds `TextExtractionOptions` and `PageTextContent { readonly text: string }` to the `PreviewDocument` contract.
- `packages/pdf-browser/src/preview/index.ts` — implements `extractText(sourcePageNumber, { signal })`. The method walks PDF.js's `page.getTextContent({ includeMarkedContent: false })` items in content-stream order, concatenates each `item.str`, emits a literal `\n` where `item.hasEOL === true`, filters marked-content items (no `.str`) at the boundary, and returns `{ text: string }`. Cancellation is checked before and after `getTextContent`, and the busy-page lock plus `page.cleanup()` match the existing render/renderJpeg pattern.
- `packages/pdf-browser/src/pdf-to-text.ts` and `pdf-to-text-types.ts` — the engine. `extractPdfText(preview, plan, limits, options)` walks the plan in source order, calls `preview.extractText` per page, normalises line endings to `\n` (`normalizeLineEndings`), classifies each page as `meaningful` iff `/\S/u` matches, enforces running character and UTF-8 byte caps, joins meaningful page bodies with the constant `PAGE_SEPARATOR = "\n\n"`, and returns a frozen `PdfToTextResult` carrying `kind`, `text`, `characters`, `bytes`, `totalPages`, `pagesWithText`, `pagesWithoutText` and a per-page `pages` array. `extractPdfText` is exposed through the `./pdf-to-text` subpath export in `packages/pdf-browser/package.json`.
- `apps/web/components/pdf-to-text/session.ts` and `pdf-to-text-workspace.tsx` — the route-local session and workspace. `PdfTextSession` owns the preview document, the full extracted text (held outside the snapshot the DOM renders), the Blob URL and the Clipboard-API state machine. The workspace renders the preview strictly as a React text node inside a `<pre>` element; no `dangerouslySetInnerHTML`, no HTML or Markdown interpretation path. Copy writes the complete validated text; Download yields a UTF-8 Blob at the fixed filename `extracted-text.txt`.
- `apps/web/app/pdf-to-text/page.tsx` — the Next.js route. Reads the registry's `maxTextCharacters`, `maxTextBytes` and `maxPreviewCharacters` and asserts them before mounting. `robots: { index: false, follow: false }`.
- Fixtures: `tests/fixtures/generate_text_fixtures.py` plus `tests/fixtures/pdf/text-xss.pdf`, `text-partial.pdf`, `text-scanned.pdf` and the manifest at `tests/fixtures/pdf/text-manifest.json`. The authoring script is a deterministic optional local tool, not a product or CI dependency; it reuses the already-present ReportLab + Pillow authoring utilities.
- CSS: `apps/web/app/globals.css` adds a `.pdf-text-workspace`/`.pdf-text-preview`/`.pdf-text-no-text`/`.pdf-text-partial`/`.pdf-text-truncation`/`.pdf-text-preview-shell`/`.pdf-text-preview-label`/`.pdf-text-actions`/`.pdf-text-announcer` block, scoped and respecting the existing design tokens.
- Benchmark: `apps/web/benchmarks/run-pdf-to-text.mjs`. See `docs/benchmarks/M3B3-pdf-to-text.md` for scope, fixtures and the measurements the harness records.

## PDF.js reuse

The route calls `openPreview()` with the shared `PageLimits` and inherits the existing PDF.js configuration (`useSystemFonts:false`, `disableFontFace:true`, pinned CMap/standard-font/wasm asset base, locked `pdfjs-dist@6.3.289`, OFL Liberation Sans 2.1.5). No PDF.js worker is created outside the one already owned by the preview document. During text extraction the thumbnail scheduler is irrelevant to this route (no thumbnails are requested), and `extractText` uses the same busy-page lock as `render`/`renderJpeg`.

## Text assembly semantics

- Concatenate `item.str` in natural content-stream order.
- Emit a literal `\n` where `item.hasEOL === true`.
- Do **not** invent spaces between adjacent items. PDF.js already includes trailing spaces inside `item.str` where the content stream expresses whitespace, and inserting extra spaces blindly corrupts scripts without word separators (CJK, Thai) and punctuation adjacency.
- Normalise line endings to `\n` (CRLF and lone CR → `\n`) before counting characters/bytes.
- A page is "meaningful" iff `/\S/u` matches the normalised body — any non-whitespace Unicode code point.
- Trim nothing from meaningful page bodies that would alter their content; whitespace-only or empty bodies are classified non-meaningful and contribute neither body nor separator to the assembled text.
- Join meaningful page bodies with `"\n\n"`; pages without meaningful text contribute nothing.

Marked-content items (which carry no `str`) are filtered at the preview boundary so React never sees PDF.js live objects.

## Unicode

Text output is UTF-8 end to end. The engine measures byte length with `TextEncoder().encode(text).byteLength`. The downloaded TXT uses `type: "text/plain;charset=utf-8"`. The engine unit tests cover basic Latin, accented characters, CJK, Cyrillic and Greek. The route reuses the existing OFL-licensed PDF.js standard-font assets for its own layout; no system-font fallback is required.

## No-text / OCR behaviour

A document with zero meaningful pages returns `kind: "no-text"`, `text: ""`, `characters: 0`, `bytes: 0`, and the session does not create a Blob URL. The UI shows the honest "No text layer was found. This PDF may be scanned or image-based and may require OCR." panel. No OCR is attempted, no document is uploaded to any server, and no link to a non-existent OCR tool is offered. The scanned fixture `tests/fixtures/pdf/text-scanned.pdf` exercises this path.

## Partial-text behaviour

A document with text on some pages and no meaningful text on others returns the valid assembled text, records `pagesWithText`, lists the affected `pagesWithoutText` and keeps `kind: "text"`. The workspace renders a dashed-border `.pdf-text-partial` note identifying the affected pages (consecutive runs are grouped as `1–3, 5, 7–8`). The partial fixture `tests/fixtures/pdf/text-partial.pdf` exercises this path with pages 1 and 3 bearing text and page 2 blank.

## Preview strategy

The engine returns the complete validated text. The session builds a bounded preview using `limits.maxPreviewCharacters` (20,000 characters in the committed registry caps) with a line-boundary slice; the preview is rendered strictly as a React text node inside a `<pre>` element. When truncated, the workspace shows a visible `.pdf-text-truncation` note disclosing that the preview is shortened and that Copy and Download use the complete validated text. The full text never leaves the session's private `fullText` field until Copy or Download is pressed, and the preview is never silently truncated for Copy or Download.

## Copy / Download

- **Copy**: `navigator.clipboard.writeText(fullText)`. On success the workspace announces "Extracted text copied." via a `role="status"` live region and auto-dismisses the acknowledgement after 2 seconds. On failure (private window, permissions revoked) the session records `copyState: "failed"` and the error is `CLIPBOARD_FAILED` with the honest "clipboard is unavailable in this browser; use Download instead" copy. The clipboard payload is the complete validated text; it is never logged, written to analytics or stored.
- **Download**: a programmatically created `<a href={blobUrl} download="extracted-text.txt">` anchor. The Blob is `new Blob([fullText], { type: "text/plain;charset=utf-8" })`. The fixed filename never incorporates the source filename. The Blob URL is created once per successful extraction and revoked on reset, source replacement, pagehide and route unmount.

## Security / XSS

Extracted text is treated as untrusted document content. It is rendered strictly as a React text node inside a `<pre>` element — never `dangerouslySetInnerHTML`, never routed through a Markdown or HTML interpreter. The `tests/fixtures/pdf/text-xss.pdf` fixture carries literal `<script>alert(1)</script>`, `<img src="x" onerror="document.title=1">`, `javascript:alert('x')` and `ampersand & less < greater > quote "`; the E2E spec asserts that the payload displays verbatim, that no `<script>` or `<img>` DOM element is injected from the payload, and that the document title is unchanged by the `onerror` payload. Metadata values and unusual Unicode controls are handled the same way: literal text nodes only.

Raw PDF.js errors never reach the user: every engine failure path maps to a finite `PageErrorCode`, and the workspace displays only the mapped user-facing copy from `pdfTextErrorCopy`.

## Privacy

- Document bytes never reach the backend. The processor is uninvolved and remains the M0 liveness-only service.
- Extracted text, source filenames and content canaries never appear in network URLs, request headers, request bodies, FastAPI calls, third-party requests, `console.log`/`console.error`, analytics, `localStorage`, `sessionStorage` or `IndexedDB`.
- The source filename is normalised through `safeFileName` (strip control chars, cap length) before it is displayed; the fixed download name `extracted-text.txt` is used verbatim.
- The Clipboard API payload is never logged.
- The E2E spec installs context-wide request/console audits with synthetic filename and content canaries and asserts no leaks.

## Limits / benchmarks

Registry caps for `pdf-to-text` (reproduced from `packages/tool-registry/src/catalog.ts`):

- Inherits `maxFiles: 1`, `maxFileBytes: 10 MiB`, `maxTotalBytes: 10 MiB`, `maxPages: 200`, `maxOutputBytes: 32 MiB`.
- `maxTextCharacters: 2_000_000`.
- `maxTextBytes: 8 MiB`.
- `maxPreviewCharacters: 20_000`.

The benchmark harness and its documented record are in `apps/web/benchmarks/run-pdf-to-text.mjs` and `docs/benchmarks/M3B3-pdf-to-text.md`. The numeric results JSON is a schema-only skeleton in this commit; the authoritative record is produced on the Product Owner's Windows toolchain or in CI (see "Verification — explicit split" below). The caps are evidence-based engineering controls, not public performance guarantees; physical low-memory mobile validation remains a launch gate and may justify lowering them.

## Cancellation

Cancellation is checked:

- Before each `getTextContent` call (at the yield point in the engine).
- Immediately after each `getTextContent` call returns.
- Before the final validation phase.

A single `getTextContent` call cannot be interrupted mid-call; the engine therefore stops before scheduling the next page and discards any unpublished text. The session's `cancel()` abort propagates to both the open and extract abort controllers and returns the route to a reusable "idle" state. Stale completion is suppressed by the session's generation counter.

## Resource lifecycle

- One owned PDF.js worker (reused from the shared preview document); no new native worker is created by text extraction.
- One `PdfTextSession` per mounted route; `session.destroy()` runs on route unmount.
- The in-memory `fullText` string is only populated for `kind: "text"` results; it is cleared by `reset()`.
- The Blob URL is created once per successful extraction and revoked by `reset()`, source replacement, `pagehide`, and route unmount.
- Stale completion: the session tracks a generation counter; completion of a previous `setSource` call never publishes into a replaced session.
- `source replacement` triggers abort + release of the previous preview + revocation of the previous Blob URL before the new flow starts.
- A `window.addEventListener("pagehide", reset)` listener installs/uninstalls alongside the component mount.

## Tests

- Engine (`packages/pdf-browser/tests/pdf-to-text.test.ts`, 15+ tests): `normalizeLineEndings`, `isMeaningfulText`, source-order joining, UTF-8 byte count, CRLF normalisation, literal `<script>` content, no-text classification, partial-text classification, plan session-id mismatch, zero/negative limits, character-cap overrun, byte-cap overrun, cancellation before and after `getTextContent`, progress events, library-error wrapping to `OPERATION_FAILED`, missing `extractText`.
- Session (`apps/web/tests/pdf-to-text-session.test.ts`, 10+ tests): bounded preview with retained full text, no-text announcement with no Blob URL, partial-text file-name retention, stale-result drop under source replacement, workflow error mapping, OPERATION_FAILED wrapping, Clipboard success and failure, reset revoking the Blob URL, no filename leak into result URL or clipboard.
- E2E (`apps/web/e2e/pdf-to-text.spec.ts`, 6 tests): FR-TXT-001/002/004 extraction + Copy + Download; FR-TXT-001 XSS payload inert rendering; FR-TXT-002 partial-text affected-pages disclosure; FR-TXT-003 no-text / scanned / no-OCR panel without server upload; FR-GEN-009 cancellation returns to reusable state; axe accessibility + keyboard tab order on the result state.

Independent output inspection: the engine's deterministic `item.str` + `hasEOL` assembly is unit-testable without PDF.js; the fixtures carry known canary strings whose exact presence (not just approximate text) is asserted; the E2E spec reopens the downloaded TXT as UTF-8 and verifies byte-equivalent content.

## Commit

M3B.3 is committed as commit group 1 on `feat/m3b-complete-local-tools`. The commit SHA is recorded in the final M3B remainder completion report alongside M3B.4's commit SHA.

## Verification — explicit split of who executed what

Per the current environment constraint (Cowork is Linux with Node 22 and no pnpm; the mounted repository is the Product Owner's Windows working tree; the mounted `node_modules` holds Windows-native binaries that cannot be rebuilt for Linux without altering the Windows setup):

- **Executed locally by Claude Cowork**: static inspection of every materially changed file, Git state verification, retrospective documentation authoring, local Git commits of the M3B.3 slice on `feat/m3b-complete-local-tools`. The engine's TypeScript, the session's state machine and the workspace component were reviewed line-by-line for the invariants above but **not** executed through `tsc`, `vitest`, `playwright`, `eslint`, `prettier`, `ruff`, `mypy`, `pytest` or Docker in the Cowork sandbox: doing so would have required mutating the mounted Windows `node_modules`, which the Product Owner explicitly forbade.
- **Executed by hosted GitHub Actions**: once `feat/m3b-complete-local-tools` is pushed, the required `web`, `processor` and `processor-container` jobs run on the branch head. Those runs are the authoritative automated verification for formatting, lint, strict TypeScript, Vitest unit/integration, production build, Playwright on the configured matrix, dependency and container audits.
- **Executed by the Product Owner on Windows**: the manual browser acceptance of the complete `/pdf-to-text` workflow across the committed fixtures (text-partial, text-xss, text-scanned) and at least one representative natural PDF. Section "Owner manual tests required" in the final M3B remainder report enumerates the exact scenarios.

## Deviations, limitations and unresolved issues

- No deviation from the approved M3B.3 scope. The engine's one dependency choice — reusing PDF.js's `getTextContent` — is the explicitly approved path.
- Reading-order fidelity for multi-column journal articles and highly positioned text is bounded by PDF.js's natural content-stream order. The UI and ADR-019 disclose this honestly. The product does not attempt column reconstruction, table recovery or geometry-based reading-order inference.
- The browser Clipboard API can be denied. The session surfaces `CLIPBOARD_FAILED` and keeps the Download path available.
- The authoritative benchmark run is not executed in this Cowork session. The committed harness and schema file enable the Product Owner / CI to run and attach results in a follow-up commit.
- Physical low-memory mobile verification remains a launch gate.

## Recommended next milestone

Proceed only to **M3B.4 — Remove PDF Metadata** on the same `feat/m3b-complete-local-tools` branch as a separate commit group. Do not begin M4 or any later milestone.
