# M3B.2 COMPLETION REPORT — PDF to JPG

Date: 2026-10-11

Status: Implemented under the approved M3B.2 scope and **accepted by the Product Owner on 11 October 2026** after manual browser verification on Windows at `http://127.0.0.1:3000/pdf-to-jpg`. This is the final M3B.2 closeout. The milestone is formally closed on merge of PR #12.

The milestone's architecture rationale and limit evidence remain in [ADR-018](../adr/018-m3b2-pdf-to-jpg.md) and [docs/benchmarks/M3B2-pdf-to-jpg.md](../benchmarks/M3B2-pdf-to-jpg.md). This report records implementation, verification and the Product Owner acceptance.

## Product Owner acceptance

The Product Owner ran the local development server on Windows and manually tested the complete `/pdf-to-jpg` workflow against representative PDFs. The workflow and generated outputs passed Product Owner review on 11 October 2026. M3B.2 is formally approved.

## Implementation summary

`/pdf-to-jpg` provides the complete local flow: choose one PDF, open bounded page previews, choose All pages or Selected pages, choose 96/150/300 DPI (150 default), render JPGs sequentially, validate each output, and download either a direct `page-NNN.jpg` for one page or a `pdf-pages-jpg.zip` for multiple pages. The registry lists PDF to JPG as `LOCAL` and `available`, retains the accepted PDF type, and carries the engineering caps described below. The route is noindex while the product remains pre-launch.

Explicit selections are filtered through source order via the shared stable page-ID model, so filenames and ZIP order always follow the source PDF page order independently of click order.

## Reuse, architecture and new code

M3B.2 reuses the M2B/M3A/M3B.1 foundations: the PDF.js preview session owner, the single PDF.js worker, stable page IDs, the bounded thumbnail scheduler, the shared `PageSelectionGrid` (M3A.2), the `usePagePreview` hook (M3A.1), the dynamically imported `fflate@0.8.3` (M3A.3), safe finite errors, cancellation, generation guards and Blob/Object URL cleanup. No second PDF engine, raster engine or workflow framework was introduced.

The engine extension is confined to the preview module and a new raster-export module:

- `packages/pdf-browser/src/preview/index.ts` gains a `renderJpeg(number, options)` method on `PreviewDocument` that uses the already-loaded document and the single native worker.
- `packages/pdf-browser/src/pdf-to-jpg.ts` and `pdf-to-jpg-types.ts` implement `renderPdfPagesToJpeg(preview, plan, limits, options)` with sequential rendering, per-page preflight, output inspection and optional ZIP packaging.
- `packages/pdf-browser/package.json` adds a narrow `./pdf-to-jpg` subpath export.
- `apps/web/app/pdf-to-jpg/page.tsx` and `apps/web/components/pdf-to-jpg/pdf-to-jpg-workspace.tsx` compose the route and workspace. The workspace reuses `FilePicker`, `ToolShell`, `PageSelectionGrid` and `usePagePreview`; the only new UI is a DPI radio group.

The rendering configuration (reproduced from ADR-018):

- Pixels per page: `round(points × DPI / 72)`.
- PDF.js applies the page crop box and source rotation. Every render starts with an opaque white background (`page.render({ canvas, viewport, background: "#ffffff" })`).
- JPEG quality is fixed at `0.9` so the interface does not imply unsupported quality guarantees.
- One page returns a direct Blob named `page-NNN.jpg`; multiple pages use the existing dynamically imported `fflate@0.8.3` and the fixed `pdf-pages-jpg.zip` name.

Output validation walks each JPEG's markers (`inspectJpeg` confirms SOI/EOI and extracts width/height from the SOF marker), decodes via `createImageBitmap` to confirm declared dimensions, cross-checks against the renderer's declared geometry, and tracks combined bytes against `maxCombinedOutputBytes`. The multi-output ZIP is reopened via `unzipSync` and every entry name and byte length is cross-checked before publication; any mismatch throws `OUTPUT_INVALID`. The archive byte length is checked against `maxArchiveBytes`.

Per-page preflight checks every page's pixels against `maxPixelsPerPage` and `maxCanvasBytes`, and aggregates pixels against `maxAggregatePixels`, before any rendering begins.

## Resource lifecycle and cancellation

The route inherits the one owned PDF.js worker; `renderJpeg` adds no additional native worker. The thumbnail scheduler pauses while full-page pages render sequentially (same pattern as structural export). Each full-page render task is awaited to settle before destroying the loading task, worker and document references; canvases are zero-sized; `page.cleanup()` is called in `finally`. Replacement, reset, pagehide, unmount and client-side navigation release references and revoke owned Blob URLs. These are resource-lifecycle controls, not secure-erasure claims.

Cancellation points are placed before each page's render, before each page's validation, before the archive, and after the archive. The engine fully terminates on `AbortSignal`. Browser test instrumentation (`apps/web/e2e/pdf-to-jpg.spec.ts`) exercises these cancellation paths; the engine unit test (`packages/pdf-browser/tests/pdf-to-jpg.test.ts`) covers the deterministic cancellation guarantees that commits `f1b412c` and `057c4da` stabilised.

## Correctness and independent raster evidence

Unit tests cover DPI geometry, source ordering, direct and ZIP output, malformed and encrypted inputs, atomic failure, cancellation, output validation, privacy, accessibility and lifecycle cleanup. Browser tests independently reopen the generated ZIP, confirm the exact fixed-name inventory and verify dimensions and page count.

Reproduced from `docs/benchmarks/M3B2-pdf-to-jpg.md` and `M3B2-reference-comparison.json`: Poppler `pdftoppm` independently renders the same crop boxes at the same effective dimensions. Across four 150 DPI pages and the rotated page at 300 DPI, normalised mean pixel differences are 0.34%–0.61%. These small differences include independent antialiasing and JPEG encoding and are not failures.

The browser JPEG encoder determines exact compressed bytes, so identical PDFs can produce different byte streams across engines. The validation strategy (markers + decode + ZIP inventory + byte-length cross-check) does not promise byte-for-byte parity across engines and the UI copy does not claim otherwise.

## Privacy and security evidence

The complete choose → preview → select → render → download → reset journey is request-audited. All observed requests are same-origin GETs with no body. Document bytes, synthetic sensitive filenames and content canaries do not appear in URLs, headers, request bodies or console output; no WebSocket, FastAPI call, processing mutation, third-party request, local storage, session storage or IndexedDB is created. PDF.js worker, font, CMap and codec assets remain application-origin and route-local. Unrelated product routes continue to load zero PDF.js/font assets.

Fixed output filenames (`page-NNN.jpg`, `pdf-pages-jpg.zip`) never incorporate source filenames.

## Dependencies and licensing

M3B.2 adds no production or development dependency and does not change the lockfile. The local route reuses the reviewed `pdfjs-dist@6.3.289` preview document, first-party PDF.js/OFL assets and the existing dynamically loaded `fflate@0.8.3`. JPEG encoding uses the browser canvas API. No image codec package, alternate PDF engine, server document engine, AGPL package, persistence or analytics integration is introduced. Existing notices, asset verification and locked JavaScript/Python audits remain applicable. ADR-018 records the rendering, output-validation, archive, lifecycle and measured-limit decisions. The dependency review's `M3B.2 PDF to JPG` entry (10 October 2026) is retained.

## Engineering limits

Registry caps for PDF to JPG, reproduced from `packages/tool-registry/src/catalog.ts`:

- Inherits `maxFiles: 1`, `maxFileBytes: 10 MiB`, `maxTotalBytes: 10 MiB`, `maxPages: 200`.
- `maxOutputBytes: 64 MiB` per generated image.
- `maxSelectedPages: 50`.
- `maxPixelsPerPage: 25,000,000` (25 MP).
- `maxAggregatePixels: 220,000,000` (220 MP across the batch).
- `maxCanvasBytes: 100,000,000` (100 MB RGBA per page).
- `maxCombinedOutputBytes: 64 MiB` across all JPGs.
- `maxArchiveBytes: 64 MiB` for the ZIP.

These are measured engineering limits documented in ADR-018 and remain subject to physical low-memory mobile validation before public launch.

## Benchmark observations

Reproduced from `docs/benchmarks/M3B2-pdf-to-jpg.md`:

- Mixed crop/orientation fixture: 4 pages at 150 DPI, 5,046 ms previews, 4,210 ms output, 174,606-byte ZIP, 174,184-byte combined JPG, peak 1 worker, peak 1 Blob URL.
- Rotated crop-box page: 1 page at 300 DPI, 4,872 ms previews, 5,752 ms output, 88,362-byte ZIP/output.
- Fifty blank Letter pages at the cap: 50 pages at 96 DPI, 4,439 ms previews, 8,896 ms output, 295,372-byte ZIP, 290,350-byte combined JPG.

Every scenario produced the exact expected page count, dimensions and effective orientation with no cross-origin or non-GET request and no page error. Reset returned live worker and Blob URL counts to zero. The 300 DPI representative page remained below the 25 MP / 100 MB per-page caps. The 50-page case remained below the 220 MP aggregate cap.

Independent Poppler comparison recorded normalised mean pixel differences of 0.34%–0.61% across the inspected pages, attributable to rasterizer antialiasing and JPEG encoding.

## Materially changed files/modules on `codex/m3b2-pdf-to-jpg`

- Engine: `packages/pdf-browser/src/preview/index.ts` (added `renderJpeg`), `packages/pdf-browser/src/preview/types.ts` (added `JpegRenderOptions`, `JpegRenderResult`), `packages/pdf-browser/src/pdf-to-jpg.ts`, `packages/pdf-browser/src/pdf-to-jpg-types.ts`.
- Package manifest: `packages/pdf-browser/package.json` added the `./pdf-to-jpg` subpath export.
- Route and workspace: `apps/web/app/pdf-to-jpg/page.tsx`, `apps/web/components/pdf-to-jpg/pdf-to-jpg-workspace.tsx`.
- Registry: `packages/tool-registry/src/catalog.ts` flipped `pdf-to-jpg` from `planned` to `available` and added the raster caps.
- Styles: minor route-local CSS in `apps/web/app/globals.css` for the DPI radio group.
- Trust/discovery copy: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/tools/page.tsx`, `apps/web/app/privacy/page.tsx`, `apps/web/app/about/page.tsx` updated to say "Eight tools" where the previous wording said "Seven tools".
- Tests: `packages/pdf-browser/tests/pdf-to-jpg.test.ts`; `apps/web/tests/pdf-to-jpg-session.test.ts`; `apps/web/e2e/pdf-to-jpg.spec.ts`.
- Governance and evidence: `docs/adr/018-m3b2-pdf-to-jpg.md`, `docs/dependency-review.md` (M3B.2 entry), `docs/benchmarks/M3B2-pdf-to-jpg.md`, `docs/benchmarks/M3B2-pdf-to-jpg-results.json`, `docs/benchmarks/M3B2-reference-comparison.json`.
- Documentation closeout appended at acceptance time (this report): `docs/reports/M3B2-milestone-report.md` and the retrospective backfills for `M3A3-milestone-report.md` and `M3B1-milestone-report.md`; `README.md` updated from seven to eight available local tools.

The processor source and `.github/workflows/ci.yml` were unchanged by this slice.

## Verification — explicit split of who executed what

Per the project's current environment constraint (Cowork is Linux; the mounted repository is the owner's Windows working tree; the mounted `node_modules` holds Windows-native binaries) the executed/CI/owner split for this milestone is:

- **Executed by Claude Cowork locally**: static code inspection of every materially changed file; Git state verification; retrospective documentation authoring; local Git commits of the closeout files on `codex/m3b2-pdf-to-jpg`. No `pnpm`, `playwright`, `vitest`, `ruff`, `mypy` or Docker was executed from the Cowork Linux sandbox against the Windows `node_modules`; doing so would have required mutating the owner's `node_modules` for Linux ABIs, which the owner explicitly forbade.
- **Executed by hosted GitHub Actions**: the required `web`, `processor` and `processor-container` jobs on PR #12 (headers `be619c2`, `f1b412c`, `057c4da`). On merge, the same required jobs run again on `main`. Specific run IDs are recorded on the PR and on the merge commit.
- **Executed by the Product Owner on Windows**: `pnpm dev` on 11 October 2026 followed by manual browser acceptance of the complete `/pdf-to-jpg` workflow across representative PDFs. The outputs and workflow passed Product Owner review.

## Deviations, limitations and unresolved issues

No unapproved architecture, dependency, processing-location or scope deviation. The engine extension is confined to a `renderJpeg` method on the existing `PreviewDocument` and a new `pdf-to-jpg.ts` module — no second PDF engine, no new native worker, no server fallback, no OCR, no AI.

PDF to JPG does not:

- preserve document-level bookmarks, forms or signatures;
- produce byte-identical JPGs across browser engines (the browser canvas encoder determines exact bytes);
- advertise its measured latencies as public performance guarantees;
- claim secure memory erasure.

Physical low-memory mobile verification remains a launch gate.

PR head immediately before merge: `057c4da7f76505d18cff8609f0c71d2d35d69f8b` on `codex/m3b2-pdf-to-jpg` (plus the one documentation closeout commit added at acceptance time, whose SHA will be recorded in the merge commit). The resulting `main` commit SHA will be recorded on the merge for traceability.

## Recommended next milestone

After this milestone closes on merge, proceed only to M3B.3 — PDF to Text (`FR-TXT-001` – `FR-TXT-004`). Do not begin M3B.4 or M4 before explicit approval.
