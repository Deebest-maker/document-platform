# ADR-014: M3A.1 local Organize PDF product slice

Date: 2026-09-29

Status: Accepted after owner review and merged in PR #5.

## Authority

The approved M3 plan and M3A.1 implementation instruction apply Roadmap M3A, PRD/SRS requirements FR-ORG-001 and FR-ORG-002, the global privacy/accessibility requirements, and ADR-012/ADR-013. This record covers Organize PDF only. Extract, Delete, Rotate, Split and M3B remain outside this slice.

## Decision

- Publish `/organize-pdf` as a `LOCAL` tool only after its complete choose, preview, reorder, validated export, download and reset flow is functional. Keep the route noindex while the product remains pre-launch.
- Reuse the M2B PDF.js preview owner, stable page IDs, bounded renderer, page-operation worker, validation, cancellation, generation guards and Blob/Object URL lifecycle. Do not introduce another PDF engine or a generic document workflow abstraction.
- Keep the app-owned Organize session narrowly responsible for the active file, preview ownership, page order, export state, result ownership and cleanup. Supply registry-derived page/byte limits to the existing session rather than duplicating them.
- Reorder by stable source-page ID through accessible Move earlier/Move later controls. The first and last boundaries are disabled, focus remains on the moved page control, and the announced position reflects the completed move. Drag and drop is not part of M3A.1.
- Export through the existing structural worker and exact page plan. Reopen and validate the output before exposing the fixed `organized.pdf` download. Source bytes remain unchanged.
- Extend the shared `FilePicker` only with an optional single-file mode while retaining its existing multi-file default and Merge behavior. Make selection optional on `PageThumbnail` so Organize does not expose an irrelevant checkbox. These are minimal shared foundations required by the product route.
- Retain the M2B rendering scheduler and 200-page engineering limit. Reordering changes React order only and does not request a thumbnail rerender for canvases already rendered.
- Add no production dependency, server processing, analytics, persistence or processing mutation endpoint.

## Evidence and consequences

Unit and browser tests verify exact stable-ID order, repeated moves, mixed geometry/rotation, source replacement, stale-result rejection, cancellation, resource cleanup, recovery, keyboard focus, announcements, reflow, reduced motion, mobile layout and a complete local-only network audit. Independent pypdf and Poppler checks confirm the produced file reopens and preserves expected order, boxes and rotations.

The focused 10/50/100/200-page product benchmark records zero rerenders for previously rendered thumbnails during 24 repeated moves, zero horizontal overflow, canvas cleanup on reset and only same-origin GET requests. It is development-machine evidence rather than a public performance guarantee or physical-mobile result.

Organize does not preserve or promise document-level bookmarks, forms or signatures beyond the existing M2B structural-operation contract. It is not a PDF repair, sanitization or secure-erasure feature.
