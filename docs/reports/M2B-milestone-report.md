# M2B COMPLETION REPORT — PDF Preview & Page-Operation Foundation

Date: 2026-09-28

Status: Implemented on `feat/m2b-pdf-foundation`; owner acceptance pending. This report covers the approved M2B foundation only. No M3 product route or document-processing feature was introduced.

## Implemented and architecture

M2B adds a local browser foundation for PDF inspection, bounded thumbnail rendering and structural page transformations. An immutable page plan gives every source page a stable opaque identity (`session UUID + original 1-based page number`) independent of order, selection and rotation. Reorder validates an exact permutation; rotate composes quarter turns with source rotation; extract/delete preserve current order. Export reparses the original bytes, copies planned pages once, validates reopened output geometry, rotation and content-stream hashes, and returns a Blob only after validation.

`pdf-lib` remains the structural engine and existing Merge worker remains separate. `pdfjs-dist@6.3.289` is isolated behind a lazy preview entry point with one explicitly owned worker. At most one short-lived structural worker joins it during export; preview rendering pauses and settles first. React receives immutable page data, finite safe errors and lifecycle callbacks rather than raw engine objects.

The scheduler uses direct canvases, one active render, at most eight retained/queued thumbnails, 240 × 320 CSS-pixel fit, DPR capped at 2 and 307,200 pixels per canvas. Replacement/reset/unmount cancel renders, destroy workers/documents, clear backing stores, release source references and revoke owned result URLs. These are resource-lifecycle controls, not secure-erasure or total-browser-memory claims.

Only two genuinely shared UI foundations were added: `PageThumbnail` and `ReorderControls`. The integration consumer is a separate noindex test application under `apps/web/tests/page-foundation`; it requires `PDF_FOUNDATION_TEST=1`, returns 404 otherwise, and is absent from product navigation, sitemap and production route code.

## Dependencies, licensing and assets

- Pinned `pdfjs-dist@6.3.289` under Apache-2.0. A version-specific package override excludes its optional Node canvas dependency. PDF.js viewer, legacy, sandbox/QuickJS and source-map assets are not packaged.
- The four bundled Liberation 1.07.4 GPLv2 font files are intentionally not shipped. After the owner-approved compatibility spike, the project supplies the unmodified official Liberation Sans **2.1.5** Regular, Bold, Italic and BoldItalic files separately under SIL OFL 1.1.
- Exact upstream release/archive source, original filenames, name-table metadata, OFL text and SHA-256 hashes are retained in `packages/pdf-browser/assets/liberation-sans/2.1.5/provenance.json` and `THIRD_PARTY_NOTICES.md`. Build verification checks all four hashes and byte inequality from the excluded PDF.js files.
- The first-party asset allowlist contains exactly 198 reviewed PDF.js CMap/Foxit/codec/ICC/worker/font assets. Production preparation rejects missing, changed or extra files. Unrelated routes load zero PDF.js/font assets.
- `pnpm audit` and the locked Python audit found no known vulnerabilities. The dependency/license inventory found no AGPL addition.

The font experiment covered 36 pages in Chromium, Firefox and WebKit: the previously failing Helvetica clipping fixture, standard Helvetica regular/bold/italic/bold-italic, embedded-font and Latin/Greek/Cyrillic controls, crop/rotation, form appearance and annotations. With `useSystemFonts:false` and `disableFontFace:true`, missing content rendered, expected geometry/clipping remained correct, no obvious spacing/wrapping regression appeared, and no unexpected network request or console diagnostic occurred. Independent Poppler comparisons agreed within normal raster differences. Evidence is in `docs/benchmarks/M2B-ofl-fonts.md`; ADR-013 records the deliberate substitution.

## Materially changed files/modules

- `packages/pdf-browser/src/page-*` and `src/preview/*`: page contracts/model/validation, structural worker bridge, PDF.js loader/worker, render scheduler and safe errors.
- `packages/pdf-browser/assets`, `scripts/prepare-pdfjs-assets.mjs`, `scripts/check-pdfjs-assets.mjs`, `THIRD_PARTY_NOTICES.md`: reviewed runtime assets, provenance, copying and release verification.
- `apps/web/components/pdf-preview`, `apps/web/tests/page-foundation`, `apps/web/e2e-foundation`, `playwright.foundation.config.ts`: app-owned session lifecycle, isolated test consumer and full browser journeys.
- `packages/ui/src/page-thumbnail.tsx`, `reorder-controls.tsx` and minimal associated styles.
- Synthetic fixtures/authoring scripts, font-gate evidence, benchmark harness/results, ADR-013, dependency review, README and CI browser-matrix configuration.

## Correctness, privacy, accessibility and lifecycle evidence

- Unit tests cover page identity/session staleness, exact permutations, reorder/rotate/extract/delete, output validation, source limits, worker success/abort/crash/protocol failures, render queuing/cancellation, preview teardown and replacement recovery.
- Browser tests reopen transformed outputs and verify exact page marker, geometry and rotation. A separate browser-generated two-page review artifact was independently inspected with pypdf: order `P4, P1`, rotations `180°, 0°`, both media boxes 500 × 650, expected extracted synthetic text. Poppler 26.6 rendered both pages successfully; visual inspection confirmed the cropped/rotated P4 and embedded Latin/Greek/Cyrillic P1. Poppler emitted its known local Symbol/ArialUnicode display-font warnings; the tested content remained visible.
- Request observation covers page selection, preview, warmed offline transformation, replacement and cleanup. Requests stay same-origin GET/HEAD; synthetic filename/content canaries do not appear in network or console data; persistent browser stores remain empty. Product routes do not request PDF.js or font assets.
- Limits reject page 201 before worker creation; 200 pages and the bounded image-heavy case preview/export successfully. Encrypted/corrupt input and render failure expose safe recoverable states with no partial result.
- Keyboard selection/reorder, focus retention, status/error announcements, thumbnail association, axe checks, 320-pixel reflow, 200% text, reduced motion and mobile emulation pass. Automated evidence does not establish full WCAG conformance.

## Benchmarks and resource decision

The synthetic benchmark covers 10/50/100/200/201 mixed pages and a 50-page 6.0 MiB image-heavy file at desktop/mobile-emulated viewports with concurrency 1/2/4. Concurrency 1 was selected: concurrency 2 improved median initial batches only about 13–14% while increasing simultaneous pressure; concurrency 4 materially regressed both medians and produced long tasks. Every case ended with zero owned workers and zero canvas pixels; export peaked at two workers. Precise Chromium samples changed by about +202 KiB for mixed 200 pages and +242–272 KiB for image-heavy repeated cycles. Results describe one desktop machine and owned resources only; mobile rows are emulation, not physical-device evidence. See `docs/benchmarks/M2B-preview.md`.

## Verification status

- `pnpm check`: passed formatting, ESLint, TypeScript, **42 pdf-browser + 38 web unit tests**, reviewed-asset verification, production build and **88/88** Chromium desktop/mobile product E2E cases.
- Expanded product matrix: **220/220 passed** across Chromium, mobile Chromium, Firefox, WebKit and mobile WebKit.
- Expanded isolated foundation matrix: **40/40 passed** across the same five profiles, including 200/201-page boundaries, output validity, local-only privacy, lifecycle and recovery.
- Processor baseline: locked sync, Ruff format/lint, mypy and **2/2 pytest** cases passed. Locked Python audit and `pnpm audit` found no known vulnerabilities.
- The existing local Docker engine was unavailable for a fresh restricted-container run; no processor/container code changed. Hosted `processor-container` remains the authoritative clean-runner gate.

The expanded product run initially exposed WebKit timing/prefetch/screenshot portability differences. Assertions now wait for navigation cleanup, check unpublished HTTP routes through the request client, and use viewport evidence when 200% text exceeds WebKit's 32,767-pixel screenshot limit. The first hosted full-matrix run also showed that Linux WebKit includes different link stops in its keyboard tab order; the test now performs a bounded sequence of real Tab presses until the target, preserving its keyboard-only assertion across host preferences. A separate local Firefox attempt failed before page creation because the restricted Windows sandbox denied Firefox tab subprocesses; the identical unmodified suite passed with approved browser-process permission. No timeout, retry, privacy, accessibility or correctness requirement was weakened.

## Limitations, deviations and unresolved decisions

No unapproved architecture or product-scope deviation. This foundation does not expose Split, Organize, Delete, Rotate or Extract as product tools; add a range parser or ZIP flow; preserve document-level forms/bookmarks/signatures; sanitize/repair PDFs; add authentication, persistence, analytics or server processing; or claim hard total-memory bounds. PDF.js glyph-path rendering and the reviewed fixture corpus do not prove fidelity for every font/PDF. Physical-mobile performance and final public product limits remain future acceptance work.

The planned hosted CI/PR references and final commit hashes will be added after publishing this branch. No M3 decision has been made.

## Recommended next milestone

After owner review and explicit acceptance of this report, plan M3 against the roadmap and current ADRs. Define each product tool's user flow, limits and acceptance evidence before implementing it. Stop after M2B closeout and wait for explicit approval.
