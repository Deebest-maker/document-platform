# ADR-013: M2B PDF preview and page-operation foundation

Date: 2026-09-27

Status: Implemented under the approved M2B plan and font-alternative evaluation; owner acceptance pending.

## Authority

M2B implementation approval and subsequent font-alternative instruction refine Roadmap M2/E04/E05, applicable SRS page-operation, privacy and accessibility requirements, and ADR-012. M3 product tools remain outside this milestone. Required CI jobs and processor architecture remain unchanged.

## Rendering assets and licensing

- `pdfjs-dist@6.3.289` remains the Apache-2.0 rendering engine. Its bundled Liberation 1.07.4 GPLv2 assets are intentionally not shipped.
- Supply the four **unmodified Liberation Sans 2.1.5** files from the official Liberation Fonts release under **OFL-1.1**, after the explicitly approved compatibility spike. Preserve original filenames, font bytes, full copyright/license text and exact archive/file hashes in `packages/pdf-browser/assets/liberation-sans/2.1.5/provenance.json`.
- This is a deliberate asset substitution based on rendering evidence, not an inferred approval to ship the GPL assets. Copy only those four Sans variants and their notice, plus the separately reviewed PDF.js CMap/Foxit/codec/ICC subset. Asset preparation verifies hashes and excludes viewer/sandbox/QuickJS/legacy assets. The optional Node canvas exclusion applies only to this pinned PDF.js dependency.
- Use `useSystemFonts:false` and PDF.js's supported `disableFontFace:true` glyph-path rendering. This resolves the previous standard-font clipping failure without an operating-system font dependency and avoids Firefox native FontFace sanitizer diagnostics. It does not modify the supplied font files or patch PDF.js. Benchmark this rendering configuration during foundation implementation; it is not a performance guarantee.
- The bounded spike passed 36 pages across Chromium, Firefox and WebKit, including the exact failed clipping fixture, four Helvetica styles, embedded Latin/Greek/Cyrillic, crop/rotation, and static form/link appearance. Geometry matched expectations; inspected spacing and shapes agreed with independent Poppler references within ordinary raster differences. No remote requests, missing assets or console diagnostics occurred in the selected configuration. The initial native FontFace configuration emitted Firefox warnings and was not accepted. See the [evidence](../benchmarks/M2B-ofl-fonts.md).

## Foundation boundaries

Keep structural pdf-lib transformations and PDF.js inspection/rendering behind separate lightweight package entry points; no raw engine objects cross into React. Stable opaque identities are `session UUID + immutable 1-based source page`, independent of order, selection and rotation. A source replacement creates a new session and stale callbacks are generation-guarded.

Use one owned PDF.js worker plus at most one short-lived structural worker per active session. A static worker-module import installs the PDF.js message handler before its initial handshake. Thumbnail scheduling pauses and active renders settle before structural export. Document teardown cancels and awaits render tasks before destroying the loading task, document/worker references and canvases.

Use direct canvases and a visible/nearby queue with selected limits of concurrency 1, eight retained/queued entries, 240 × 320 CSS-pixel fit, DPR capped at 2 and 307,200 pixels per canvas. The [benchmark](../benchmarks/M2B-preview.md) found only modest concurrency-2 improvement and material concurrency-4 regression. The bounds describe resources owned by the foundation, not total browser/PDF.js/GPU memory and not secure erasure.

Expose only immutable page plans, plain geometry and safe finite error codes to React. Reorder requires an exact permutation; extract/delete preserve current order; quarter-turn deltas compose with source rotation. Structural export reparses the source, copies planned pages once, validates content-stream hashes/boxes/rotation after reopening, and returns a Blob only after successful validation. It does not preserve document-level forms, bookmarks or signatures.

The only shared UI additions are `PageThumbnail` and `ReorderControls`. The integration consumer is a separately built Next application under `apps/web/tests/page-foundation`, requires `PDF_FOUNDATION_TEST=1`, remains noindex, and returns 404 in its default configuration. It is absent from product navigation, sitemap and route code.

No M3 route, range parser, organizer, multi-output ZIP flow, authentication, persistence, analytics or server document processing is introduced. Existing Merge behavior and its worker remain separate.
