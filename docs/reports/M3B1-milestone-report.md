# M3B.1 COMPLETION REPORT — Images to PDF

Date: 2026-10-11

Status: Retrospectively authored. M3B.1 was implemented and the primary route merged under PR #10 on 7 October 2026; a required CI closeout followed under PR #11 on 8 October 2026 to address a GitHub Advisory Database update affecting `next@16.3.6`. Both PRs were accepted by the owner at that time; this closeout report is written on 11 October 2026 during the M3B.2 acceptance cycle to repair the documentation gap identified by the Claude Cowork onboarding audit. The report uses only repository-retained evidence (ADR-017, benchmark records, dependency review entries, Git history and the current merged implementation). Specific hosted-CI run identifiers are not reproduced because they are not retained in the repository and this report deliberately does not invent historical evidence.

## Implementation summary

`/jpg-to-pdf` provides the complete local flow: choose JPEG and/or PNG images, preview and arrange them, select Auto/A4/Letter page size and Contain/Cover layout, generate the PDF locally, download `images-to-pdf.pdf`, and start over. The registry lists Images to PDF as `LOCAL` and `available`, declares the two accepted image types, and carries the engineering caps described below. The route is noindex while the product remains pre-launch.

Each image produces one PDF page. Auto uses 96 CSS pixels per inch mapped to 72 PDF points; A4 and Letter use exact physical point sizes. Contain is the default and preserves the full image inside the page; Cover crops to fill and is clearly disclosed in-UI. Page orientation is Auto, Portrait or Landscape.

An opaque white page is drawn before every image so transparent PNG regions have deterministic white backing. Reopened output is validated for page count and geometry before the fixed `images-to-pdf.pdf` download becomes available.

## Reuse, architecture and new code

M3B.1 reuses the already reviewed `pdf-lib@1.17.1` worker engine, the shared `FilePicker` (now with an accessible item label on the reorder control) and the existing privacy/accessibility baselines. The one architecturally novel element is EXIF orientation handling: JPEG/PNG signatures and dimensions are inspected locally before decode; the JPEG EXIF IFD0 orientation tag is parsed internally; and because worker canvas export and EXIF decode behaviour differ across engines, the route removes the EXIF APP1 segment and normalises an oriented JPEG once in a route-owned canvas before the normalised encoded Blob reaches the PDF worker. Unoriented images retain their original encoded bytes. The temporary full-size bitmap is closed immediately after use.

The sequential route-owned worker generates PDF pages one at a time. Preview generation is sequential and bounded to 320 pixels. Reset and navigation revoke every owned Blob URL. Generation cancellation terminates the worker and leaves the route in a reusable ready state. ADR-017 records why the EXIF normalisation path is bounded to the route (WebKit's canvas-export behaviour differed from Chromium/Firefox in a worker-only EXIF path; the current path is the tested compatibility route).

New code is concentrated in:

- `apps/web/app/jpg-to-pdf/page.tsx` and `apps/web/components/images-to-pdf/images-to-pdf-workspace.tsx` and `session.ts` for the route and workspace.
- `packages/pdf-browser/src/image-inspection.ts`, `image-layout.ts`, `image-operations.ts`, `images-to-pdf-client.ts`, `images-to-pdf.worker.ts`, `image-worker-protocol.ts`, `image-types.ts` for the engine.
- `packages/pdf-browser/tests/image-inspection.test.ts`, `image-layout.test.ts`, `image-operations.test.ts` for engine tests.
- `apps/web/tests/images-to-pdf-session.test.ts` for the session unit test.
- `apps/web/e2e/images-to-pdf.spec.ts` for the product browser suite.
- `docs/adr/017-m3b1-images-to-pdf.md`, `docs/benchmarks/M3B1-images-to-pdf.md`, `docs/benchmarks/M3B1-images-to-pdf-results.json` for the decision record and recorded evidence.

The shared `ReorderControls` was extended only to accept an accessible item label; no other shared primitive gained Images-specific logic. No alternate PDF engine, drag library, server route, persistence or analytics path was introduced.

## Correctness and independent PDF evidence

Header, geometry, operation, session and browser tests cover supported formats, malformed/mismatched inputs, size/pixel/count bounds, stable order, EXIF orientations, exact Auto/A4/Letter pages, contain/cover behaviour, output validation, cancellation, URL/worker cleanup, privacy, accessibility and desktop/mobile behaviour. The expanded browser matrix checks Chromium, Firefox and WebKit families.

Independent Poppler verification (as recorded in `docs/benchmarks/M3B1-images-to-pdf.md`) reopens five representative outputs and reports the expected 6, 4, 1, 1 and 20 pages, no encryption, no forms, no JavaScript and PDF 1.7. Rendering the transparent-PNG page with `pdftoppm` confirms the coloured centre remains visible and transparent regions appear white. The EXIF orientation-6 output renders as a 1500×900-point landscape page with its original upper-left marker rotated to the upper right. Browser tests separately verify exact reordered page geometry and Auto/A4/Letter dimensions.

## Resource lifecycle and cancellation

The route owns its own worker, its own Blob URLs and its own canvases. Sequential preview and generation close bitmaps immediately after use. Cancelling the 20-image boundary run returns to a reusable ready state and terminates the worker (measured at 112 ms in the recorded benchmark). Reset and route unmount revoke every owned Blob URL. The browser `performance.memory` sampled delta was zero and is explicitly not treated as a reliable peak-memory measurement; resource safety relies on decoded-pixel estimates, sequential processing, explicit bitmap closure, worker termination and registry caps.

## Privacy and security evidence

The complete choose → preview → generate → download → reset journey is request-audited. All observed requests are same-origin GETs with no body. No cross-origin or non-GET request is emitted; no page error, retained worker or retained Blob URL survives reset. Document bytes, synthetic sensitive filenames and content canaries do not appear in URLs, headers, request bodies or console output; no WebSocket, FastAPI call, processing mutation, third-party request, local storage, session storage or IndexedDB is created. PDF.js and font assets remain application-origin and route-local.

The fixed output name `images-to-pdf.pdf` never incorporates source filenames.

## Dependencies and licensing

M3B.1 adds no production or development dependency. It reuses the already reviewed `pdf-lib@1.17.1` worker engine plus the browser `createImageBitmap`, `OffscreenCanvas` and Blob APIs. JPEG/PNG header and EXIF-orientation inspection is implemented in the first-party browser package. No EXIF library, image codec package, drag library, server document engine, AGPL package, persistence or analytics integration is introduced. Existing notices and locked JavaScript/Python audits remain applicable. ADR-017 records the processing, output-validation, lifecycle and measured-limit decisions.

A post-acceptance CI security closeout (PR #11) addressed `GHSA-cjq9-62q9-8jv4`, which caused the required audit to reject `next@16.3.6`. The advisory affects Next.js versions from 16.0.0 through 16.3.7 and identifies 16.3.8 as patched. The web runtime and matching lint configuration now use exact `next@16.3.8` and `eslint-config-next@16.3.8`; the lockfile records the registry integrity values and matching platform SWC packages. The update adds no route, product capability, document-processing path, infrastructure or license category. The locked audit reports no known vulnerabilities. The dependency review contains the M3B.1 and M3B.1-closeout entries.

## Engineering limits

Registry caps for Images to PDF, reproduced from `packages/tool-registry/src/catalog.ts`:

- `maxFiles: 20`
- `maxFileBytes: 10 MiB`
- `maxTotalBytes: 32 MiB`
- `maxPages: 20`
- `maxOutputBytes: 64 MiB`
- `maxWidth: 8192`, `maxHeight: 8192`
- `maxPixelsPerImage: 24,000,000`
- `maxAggregatePixels: 160,000,000`
- `maxDecodedBytesPerImage: 96,000,000`
- `maxAggregateDecodedBytes: 640,000,000`

These are measured engineering limits documented in ADR-017 and remain subject to physical low-memory mobile validation before public launch, which may justify lowering the 160 MP aggregate cap.

## Benchmark observations

Reproduced from `docs/benchmarks/M3B1-images-to-pdf.md`:

- Six phone-size JPEGs: 1,066 ms previews ready, 920 ms PDF ready, 438,674-byte output, peak 7 live Blob URLs.
- Mixed portrait/landscape JPEG and transparent PNG: 480 ms previews ready, 1,923 ms PDF ready, 155,875-byte output, peak 5 live Blob URLs.
- Single 6000×4000 JPEG at 24 MP boundary: 406 ms previews, 233 ms PDF, 145,663-byte output, peak 2 live Blob URLs.
- EXIF orientation 6 JPEG: 226 ms previews, 246 ms PDF, 17,410-byte output, peak 2 live Blob URLs.
- Twenty 1200×900 JPEGs at the count boundary: 541 ms previews, 276 ms PDF, 163,578-byte output, peak 21 live Blob URLs.

Every scenario completed without horizontal overflow, cross-origin or non-GET requests, page errors, retained workers or retained Blob URLs after reset.

## Materially changed files/modules (as merged into `main` through PRs #10 and #11)

- Product route and workspace: `apps/web/app/jpg-to-pdf/page.tsx`, `apps/web/components/images-to-pdf/images-to-pdf-workspace.tsx`, `apps/web/components/images-to-pdf/session.ts`.
- Engine: `packages/pdf-browser/src/image-inspection.ts`, `image-layout.ts`, `image-operations.ts`, `images-to-pdf-client.ts`, `images-to-pdf.worker.ts`, `image-worker-protocol.ts`, `image-types.ts`.
- Shared infrastructure: `packages/ui/src/reorder-controls.tsx` gained the accessible item-label prop.
- Registry: `packages/tool-registry/src/catalog.ts` flipped `jpg-to-pdf` from `planned` to `available` and added the Images-specific caps and accepted types.
- Tests: `packages/pdf-browser/tests/image-inspection.test.ts`, `image-layout.test.ts`, `image-operations.test.ts`; `apps/web/tests/images-to-pdf-session.test.ts`; `apps/web/e2e/images-to-pdf.spec.ts`.
- Governance and evidence: `docs/adr/017-m3b1-images-to-pdf.md`, `docs/dependency-review.md` (M3B.1 and M3B.1-closeout entries), `docs/benchmarks/M3B1-images-to-pdf.md`, `docs/benchmarks/M3B1-images-to-pdf-results.json`.
- CI security closeout under PR #11: `pnpm-lock.yaml` resolved to `next@16.3.8` / `eslint-config-next@16.3.8`; `apps/web/package.json` version pin; small test timing adjustment in `apps/web/tests/page-foundation/.next` generation.

The processor source and `.github/workflows/ci.yml` were unchanged by this slice.

## Verification status

Required `web`, `processor` and `processor-container` GitHub Actions checks passed on both PRs before merge (branch protection enforces those three identifiers). The PR head immediately before the first squash merge is recorded in Git as `3bc0187` (branch tip of `codex/m3b1-images-pdf` after `feat: add local images to PDF workflow`); the primary merge is `587639f M3B.1: local Images to PDF workflow (#10)` on `main`. The closeout squash is `d0948ea M3B.1 closeout: stabilize CI and patch Next.js (#11)` with pre-merge head `4edfffd` on `codex/m3b1-closeout-foundation-race`. The exact hosted CI run numbers from the merge windows are not retained in the repository and are deliberately not reproduced here.

Local verification during the slice: `pnpm check` (format, lint, type, unit/integration, build, Chromium smoke E2E) and `pnpm test:foundation` passed; `pnpm audit --audit-level=high` and `uv audit --locked` reported no known vulnerabilities. The exact pass counts recorded by Codex at merge time are not retained in the repository.

## Deviations, limitations and unresolved issues

No unapproved architecture, dependency, processing-location or scope deviation. The one architecturally novel element — route-owned EXIF normalisation — was explicitly reviewed and recorded in ADR-017 after cross-browser testing specifically rejected a worker-only EXIF path on WebKit.

Images to PDF does not:

- colour-manage images beyond browser decoding;
- preserve image metadata into the output;
- promise print-production fidelity;
- preserve EXIF-oriented compression details (re-encoding can change them).

Physical low-memory mobile verification remains a launch gate; the conservative limits are engineering controls rather than permanent product promises.

Primary implementation head immediately before merge: `3bc0187` on `codex/m3b1-images-pdf`. Merged into `main` as squash commit `587639f M3B.1: local Images to PDF workflow (#10)`. Closeout head: `4edfffd` on `codex/m3b1-closeout-foundation-race`, merged as `d0948ea M3B.1 closeout: stabilize CI and patch Next.js (#11)`.

## Recommended next milestone

After owner acceptance (recorded), proceed only to M3B.2 — PDF to JPG. Do not begin M3B.3 or any other slice before explicit approval.
