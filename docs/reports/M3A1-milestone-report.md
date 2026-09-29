# M3A.1 COMPLETION REPORT — Organize PDF

Date: 2026-09-29

Status: Implemented on `codex/m3a1-organize-pdf`; owner acceptance pending. This report covers M3A.1 only. Extract, Delete, Rotate, Split and M3B were not started.

## Implementation summary

`/organize-pdf` now provides the complete local flow: choose one PDF, validate it, open bounded page previews, move pages earlier or later, export the displayed order through the validated structural worker, download `organized.pdf`, and start over. The registry marks only Organize PDF newly available, retains `LOCAL` processing, supplies the accepted type and conservative 10 MiB input, 200-page and 32 MiB output limits, and keeps the route noindex during pre-launch.

The UI exposes truthful idle, preview-loading, ready, exporting, success and recoverable error states. Export copy follows real reading, transforming and validating phases without a fabricated percentage. Conflicting edits and duplicate export are disabled while exporting; cancellation leaves the current plan recoverable.

## Reuse, architecture and new code

M3A.1 productizes the M2B foundations: PDF.js preview ownership, stable page IDs, the bounded thumbnail scheduler, page plan, pdf-lib structural worker, reopened-output validation, safe finite errors, cancellation, generation guards and resource cleanup. No PDF engine, workflow framework, global document store, server processor path, analytics or persistence was added.

The app-local Organize workspace owns only the active source session, immutable page order, preview canvases, export state and result URL. `PreviewSession` now accepts registry-derived limits and publishes real worker phases. Shared UI changes remain small: `FilePicker` has an optional single-file mode while its default preserves Merge's multi-file behavior; `PageThumbnail` can omit its M2B selection checkbox when a product does not need selection. Button and keyboard reorder remain the only reorder mechanism; no drag dependency was introduced.

New product code is concentrated in `apps/web/app/organize-pdf`, `apps/web/components/organize`, the Organize unit/E2E suites and the focused benchmark. ADR-014 records the decision. Registry, shared picker/thumbnail, preview-session limit/phase support, availability copy and styling are the material changes elsewhere. The lockfile is unchanged and the dependency review records no new dependency.

## Reorder correctness and independent PDF evidence

Unit and browser tests perform repeated stable-ID moves to produce displayed order `[2, 4, 3, 1]`; the downloaded PDF reopens with exact markers `P2, P4, P3, P1`. Expected rotations are `[0, 90, 0, 0]`, every media box remains 500 × 650, and source page 4 retains crop box `{x:40, y:50, width:420, height:560}`. The source file's SHA-256/bytes remain unchanged, and failed/cancelled validation returns no partial result.

A separate product-generated 10-page reference output was opened with independent pypdf 6.10.0. It reported order `P2, P1, P3, P4, P1, P2, P3, P4, P1, P2`, the expected media/crop boxes and the source rotation on P4. Poppler 26.6 rendered the first two pages successfully; visual inspection showed P2 followed by P1 with intact content. Poppler emitted local Symbol/ArialUnicode display-font warnings; those fonts are outside the synthetic page content and the rendered evidence was intact.

## Preview and resource lifecycle evidence

The route retains M2B's one owned PDF.js worker, one short-lived structural worker during export, one active preview render, eight retained/queued thumbnails, DPR/pixel caps and 200-page ceiling. Replacement, reset, route unmount and pagehide cancel/settle work, destroy the loading task/document/workers, clear canvas backing stores and revoke owned result URLs. Generation checks prevent an old source or export callback from publishing into a replacement session.

Browser instrumentation observed at most two simultaneous workers during export and zero live workers, result URLs or canvases after reset. Encrypted and corrupt sources reached safe error states and a valid replacement recovered. Existing M2 lifecycle/foundation tests remained green.

## Privacy and security evidence

The complete choose → preview → reorder → export → download → reset journey was request-audited. All observed requests were same-origin GETs with no request body. Document bytes, the synthetic private filename and content canary did not appear in URLs, headers, request bodies or console output; no WebSocket, processing mutation, FastAPI request, third-party request, persistent browser database, local storage or session storage was created. PDF.js worker, font, CMap and codec assets remained application-origin and route-local. Unrelated product routes continued to load zero PDF.js/font assets.

The first full regression exposed two existing Merge privacy assertions because the now-available same-origin Organize route was legitimately prefetched. The allowlist was extended only for `/organize-pdf`; method, origin, payload, canary, filename, worker, storage and console assertions remain unchanged and both desktop/mobile cases then passed.

## Accessibility and visual review

Desktop and mobile Chromium journeys verify file-choice access, keyboard-only repeated reorder, focus retention on the moved page control, disabled first/last boundaries, meaningful source-page/position announcements, programmatic processing/error status, axe checks, reduced motion, 320-pixel reflow and mobile touch layout. There is no drag-only action. Automated checks do not establish complete WCAG conformance.

The generated desktop and mobile top/grid screenshots were reviewed at representative 10/50/100/200-page loads. The page order, controls, privacy label, primary export/download action and responsive grid remain clear without horizontal overflow and follow the calm editorial utility direction.

## Performance observations

The focused production-route benchmark used synthetic mixed geometry/crop/rotation PDFs at 10, 50, 100 and 200 pages on desktop and mobile-emulated Chromium. All eight cases loaded without horizontal overflow, made only same-origin GET requests and removed canvases on reset. Previously rendered thumbnails recorded zero extra canvas renders during 24 rapid stable-ID moves.

Ready time ranged from 0.7 to 3.3 seconds on this development machine. Seven reorder samples completed 24 moves in 1.1–1.6 seconds; the desktop 100-page sample was a 5.3-second outlier. The evidence supports retaining the documented 200-page engineering limit, but is not a public performance guarantee or physical-mobile measurement. Exact rows are in `docs/benchmarks/M3A1-organize-results.json`.

## Verification and browser matrix

- Formatting, ESLint, TypeScript, production build and reviewed PDF.js asset packaging passed.
- Unit/integration: **42/42** pdf-browser and **40/40** web tests passed.
- Local product smoke: the 94-case desktop/mobile Chromium run initially had the two expected allowlist failures described above; the corrected cases passed 2/2, while the other 92 had passed. Hosted clean-runner smoke then passed the complete suite.
- Local isolated foundation: **16/16** desktop/mobile Chromium cases passed.
- Local Organize-specific journeys passed in Chromium, mobile Chromium, WebKit and mobile WebKit. Local Firefox failed in the restricted Windows environment before creating an application page (`browserContext.newPage` runtime error); no product assertion ran. The unmodified Firefox suite passed on GitHub's clean Linux runner.
- Hosted full matrix: **235/235** product cases and **40/40** foundation cases passed across Chromium, Firefox, WebKit, mobile Chromium and mobile WebKit.
- Processor baseline: locked sync, Ruff format/lint, strict mypy and **2/2** pytest cases passed. Locked JavaScript and Python audits reported no known vulnerabilities. The local Docker daemon was unavailable; both hosted restricted-container jobs built the image and verified read-only, non-root, capability-dropped operation successfully.

Hosted PR smoke [run 36522940715](https://github.com/Deebest-maker/document-platform/actions/runs/36522940715) passed required `web`, `processor` and `processor-container` on implementation commit `04851d0e8caae5e5beba6bb60912220a93fd1e21`. Manually dispatched full-matrix [run 36523216686](https://github.com/Deebest-maker/document-platform/actions/runs/36523216686) passed the same three jobs on that exact commit.

## Deviations, limitations and unresolved issues

There is no unapproved architecture or scope deviation. The shared FilePicker extension was made only after inspecting the current M2 implementation and retains Merge's default behavior. A test-only PDF oracle made crop reporting opt-in after its first form changed legacy Merge equality expectations; the corrected helper preserves the existing contract.

Organize does not provide drag reorder, arbitrary page-number entry, page rotation/deletion/extraction, PDF repair/sanitization, secure erasure or document-level bookmark/form/signature preservation guarantees. Performance mobile rows are emulated. PDF rendering and structural fidelity are bounded by the reviewed engines, fixtures and documented M2B limitations. No unresolved licensing, privacy or architecture decision blocks owner review of this slice.

Implementation commit: `04851d0e8caae5e5beba6bb60912220a93fd1e21`. [PR #5](https://github.com/Deebest-maker/document-platform/pull/5) remains open for owner review and is not merged.

## Recommended next milestone

After explicit owner acceptance of M3A.1, proceed only to the separately gated **M3A.2 — Extract/Delete/Rotate PDF pages** planning or implementation step defined by the approved M3 sequence. Do not begin M3A.2 until that approval is given.
