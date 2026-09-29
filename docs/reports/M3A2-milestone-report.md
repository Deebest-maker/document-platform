# M3A.2 COMPLETION REPORT — Extract / Delete / Rotate PDF

Date: 2026-09-29

Status: Implemented on `codex/m3a2-page-tools`; owner acceptance pending. This report covers M3A.2 only. Split PDF and M3B were not started.

## M3A.1 closeout

M3A.1 owner acceptance was recorded before this slice. PR #5 was merged through the protected branch as merge commit `b00214322caea9b4e66e2ae85fa105a5d83dc0a9`; local `main` was updated to the same commit with a clean tree. Post-merge hosted run `36543004635` passed `web`, `processor` and `processor-container` on `main`. ADR-014 now records its accepted and merged status.

## Implementation summary

Three complete noindex, anonymous, browser-local product routes are available:

- `/extract-pdf-pages`: choose one PDF, preview pages, select pages, export the selected pages in displayed order, download `extracted-pages.pdf`, and reset.
- `/delete-pdf-pages`: choose one PDF, mark pages for removal, review explicit retained/removed states, reject deletion of every page, export the exact complement, download `pages-removed.pdf`, and reset.
- `/rotate-pdf`: choose one PDF, select pages or choose the all-page scope, apply repeated left/right quarter turns, preview requested orientation, export, download `rotated.pdf`, and reset.

The registry activates only these three M3A.2 entries. Each remains `LOCAL`, uses the approved one-file, 10 MiB input, 200-page and 32 MiB output limits, and derives its metadata and privacy presentation from the registry. Global availability copy now truthfully states that five PDF tools are available.

## Reuse, new code and shared selection architecture

The routes reuse the M2B/M3A.1 `PreviewSession`, stable page IDs, PDF.js loading task and worker, bounded thumbnail scheduler, page model, structural page-operation worker, reopened-output validation, safe error categories, cancellation, stale-generation guards and Blob/Object URL cleanup. There is no second preview engine, PDF loader, page identity model, global document store or universal workflow framework.

New code is limited to three route entries, two narrow workspaces, a small shared page-selection grid/copy module, route-level tests and the focused benchmark. `PreviewSession` adds single-publication Select all/Clear selection, direction-aware rotation and derived Extract/Delete export methods. `PageThumbnail` adds only an optional tool-specific selection label.

Selection is stored as stable page IDs. Shared controls provide Select all, Clear selection and a selected count, while visible and accessible meaning stays explicit per tool: “Selected for extraction”, “Marked for removal” and “Selected for rotation”. Individual checkbox changes are not live-announced; grouped actions and workflow transitions use concise status announcements.

## Extract semantic evidence

Unit coverage sets displayed order to `[3, 1, 5, 2, 4]`, selects source pages in click order `5, 4, 1`, and proves the derived output plan is `[1, 5, 4]` while the displayed plan remains unchanged. Empty selection is rejected. Browser coverage selects source page 4 before page 2 and independently reopens the product output as `P2, P4`, proving current displayed order rather than click order. Page 4 retains source rotation 90° and crop box `{x:40, y:50, width:420, height:560}`. Source bytes remain unchanged in engine coverage.

## Delete semantic evidence

Unit and browser coverage mark source pages 2 and 4 and prove the exported complement preserves exact relative order. The four-page browser fixture reopens as `P1, P3`; the 200-page representative output contains 198 valid pages. Selecting every page disables export and displays “At least one page must remain”; the structural transform is not called for that invalid plan. Retained geometry/rotation and source bytes remain unchanged.

## Rotate semantic evidence and preview/export agreement

Unit coverage verifies selected-only and all-page `+90°`/`-90°` operations, repeated turns through 180° and 270°, and four turns back to delta 0°. Intrinsic source rotation remains separate from the requested delta. The route shows both requested change and effective orientation, and its canvas requests use the same page-plan delta passed to export.

The mixed browser journey applies `+90°` to pages 1/2, `-90°` to page 4, then `+90°` to all pages. The displayed deltas and reopened output agree: source markers remain `P1, P2, P3, P4` and effective rotations are `[180, 180, 90, 90]`. Unchanged pages retain identity and geometry.

## Resource lifecycle evidence

The routes inherit one owned PDF.js document/worker, one short-lived structural worker during export, one active preview render, an eight-entry retained queue, DPR/pixel caps and the 200-page ceiling. Replacement, reset, unmount and pagehide cancel or settle owned work; destroy loading/render tasks and workers; clear canvases and source references; and revoke result URLs. Generation checks prevent stale source, render or export callbacks from publishing into the current session.

Instrumented choose → preview → select/operate → export → download → reset journeys observed at most two simultaneous workers and zero live workers, result URLs or canvases after reset. Encrypted/corrupt source replacement recovered on every route. Existing M2B lifecycle/foundation cases remain green.

## Privacy and security evidence

Complete workflows for all three routes were request-audited. Every observed request was a same-origin GET with no request body. Synthetic sensitive filenames and content canaries did not appear in requests or console output; no WebSocket, FastAPI call, processing mutation, third-party request, local storage, session storage, IndexedDB or analytics path was created. PDF.js workers/fonts/CMaps/codecs remained application-origin. Unrelated routes still load zero PDF.js/font assets.

Merge's existing strict route allowlist was extended only for legitimate same-origin prefetches to the three newly available routes. Origin, method, body, document-byte, canary, filename, console, storage and worker assertions remain unchanged. Fixed result names never include source filenames. No production dependency, server infrastructure, persistence, analytics or logging path was added.

## Accessibility and visual review

The three workflows use native labeled checkboxes with source page numbers, explicit non-color state text, keyboard-accessible Select all/Clear selection and rotation scope controls, visible focus, actionable inline invalid-selection guidance, real processing/error status, dominant download actions and useful focus movement across state changes. Axe, keyboard interaction, reduced-motion and 320-pixel/200%-text reflow checks pass. Automated checks do not establish complete WCAG conformance.

Desktop and mobile Chromium screenshots at the 200-page limit were reviewed for all three routes. Tool/privacy identity, action hierarchy, selection meaning, rotation scope, preview geometry, responsive one-column layout and touch-sized controls remain clear without horizontal overflow and follow the established editorial utility direction.

## Performance observations

The focused production-route benchmark loads a synthetic 200-page mixed geometry/crop/rotation PDF at desktop and mobile Chromium viewports. The first visible preview became ready in 0.6–1.9 seconds on this development machine. Select all plus Clear selection completed in 137–318 ms.

All six route/viewport cases recorded zero canvas rerenders for already rendered thumbnails during selection or delete-state changes. Rotate recorded exactly one new render for the affected visible thumbnail and zero for other rendered thumbnails. The unchanged scheduler's one-active/eight-retained bound remains unit-tested. These are development-machine and mobile-emulation observations, not public guarantees or physical-device measurements. Exact rows are in `docs/benchmarks/M3A2-page-tools-results.json`.

## Independent PDF verification

Representative outputs from all three product routes were downloaded outside the unit harness and opened with Poppler 26.6:

- Extract: 2 pages; first pages reported source-equivalent rotations `[0, 90]`, with the second page's 420 × 560 crop dimensions retained.
- Delete: 198 pages from the synthetic 200-page input; retained pages reopened and rendered in source-relative order.
- Rotate: 200 pages; page 1 reported 90° after the representative selected-page turn while unchanged pages retained their source orientations.

Poppler rendered the first page of every output for visual inspection. It emitted local display-font warnings for Symbol/ArialUnicode in the synthetic fixture environment; the expected fixture content and geometry remained visible. Browser assertions independently reopened smaller semantic outputs and verified markers, counts, rotations and crop boxes.

## Verification and browser matrix

- Local formatting, ESLint, TypeScript and production build passed; reviewed PDF.js packaging retained 198 allowlisted assets plus the four separately approved unmodified OFL fonts and excluded bundled GPL fonts.
- Unit/integration: **42/42** pdf-browser and **46/46** web tests passed.
- Local desktop Chromium: **69/69** product/regression cases passed.
- Local mobile Chromium: unchanged Merge cases passed in the complete run; a clean single-worker continuation passed **54/54** Organize, M3A.2, isolation, accessibility, reflow and shell cases. A two-worker run exposed only a five-second preview-readiness race; route readiness assertions now allow 15 seconds while retaining exact page-count checks. Targeted Organize and M3A.2 desktop/mobile suites passed after that reproducibility adjustment.
- Local isolated foundation: **16/16** desktop/mobile Chromium cases passed.
- Processor: locked sync, Ruff format/lint, strict mypy and **2/2** pytest cases passed. Locked JavaScript and Python audits reported no known vulnerabilities; the Python audit reported no adverse project status.
- Hosted PR smoke run `36584492257` passed required `web`, `processor` and `processor-container` on implementation commit `e84b7bb6cb29188d2995448c0e9ec535f9a0dd77`.
- Hosted full-matrix run `36584801272` passed `web`, `processor` and `processor-container` on the same commit. It recorded **345/345** product cases across Chromium, Firefox, WebKit, mobile Chromium and mobile WebKit, plus **40/40** foundation cases, **42/42** pdf-browser tests, **46/46** web tests, **2/2** processor tests and clean locked audits. The container built and passed the existing read-only, non-root, capability-dropped verification.

## Files and modules materially changed

- Product routes: `apps/web/app/extract-pdf-pages`, `apps/web/app/delete-pdf-pages`, `apps/web/app/rotate-pdf`.
- Product UI/session: `apps/web/components/page-tools`, `apps/web/components/pdf-preview/preview-session.ts`, route styles in `apps/web/app/globals.css`.
- Shared foundations: `packages/ui/src/page-thumbnail.tsx`, `packages/tool-registry/src/catalog.ts`.
- Tests/evidence: M3A.2 session and E2E suites, expanded shell/privacy/accessibility regressions, focused benchmark runner/results.
- Governance: ADR-015, ADR index, M3A.1 accepted status and dependency review.

## Deviations, limitations and unresolved issues

There is no unapproved architecture, dependency, processing-location or milestone-scope deviation. A failed initial Extract E2E assertion and an existing Organize assertion used globally ambiguous privacy-label locators after more LOCAL related cards became available; both were scoped to their route heading. The local two-worker readiness race described above changed only test wait tolerance, not a product limit or behavior assertion.

M3A.2 does not provide range syntax, split groups, multiple outputs, ZIP files, drag interaction, repair/sanitization, secure erasure or guarantees for document-level bookmarks, forms or signatures beyond the existing structural-operation contract. Mobile performance rows are emulated. PDF rendering and structural fidelity remain bounded by the reviewed engines, fixtures and M2B limitations. No unresolved licensing, privacy, security or architecture issue blocks owner review.

Implementation commit: `e84b7bb6cb29188d2995448c0e9ec535f9a0dd77`. PR: [#6](https://github.com/Deebest-maker/document-platform/pull/6).

## Recommended next milestone

After explicit owner acceptance of M3A.2, proceed only to the separately gated **M3A.3 — Split PDF** planning/implementation step. Do not begin Split or any M3B work before that approval.
