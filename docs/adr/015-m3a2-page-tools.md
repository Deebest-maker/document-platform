# ADR-015: M3A.2 local Extract, Delete and Rotate page tools

Date: 2026-09-29

Status: Implemented under the approved M3A.2 gate; owner acceptance pending.

## Authority

The approved M3 plan and M3A.2 implementation instruction apply Roadmap M3A, SRS requirements FR-EXT-001, FR-DEL-001, FR-ROT-001 and FR-ROT-002, the global privacy/accessibility requirements, and ADR-012 through ADR-014. This record covers Extract PDF Pages, Delete PDF Pages and Rotate PDF only. Split PDF and M3B remain outside this slice.

## Decision

- Publish `/extract-pdf-pages`, `/delete-pdf-pages` and `/rotate-pdf` as `LOCAL` tools only after each complete choose, bounded preview, page selection/operation, validated export, fixed-name download and reset flow is functional. Keep the routes noindex while the product remains pre-launch.
- Reuse the M2B/M3A.1 preview session, stable page IDs, PDF.js loading task and worker, bounded renderer, structural page-operation worker, output validation, finite safe errors, cancellation, generation guards and Blob/Object URL lifecycle. Add no PDF engine, global store or universal workflow state machine.
- Keep one small shared page-selection presentation. Selection is keyed by stable IDs; the visible and accessible meaning remains tool-specific: selected for extraction, marked for removal or selected for rotation.
- Derive Extract and Delete export plans from the current immutable displayed plan without mutating the source plan. Extract follows displayed order among selected pages. Delete exports the exact complement in retained relative order and rejects deletion of every page.
- Store rotation as a user-requested delta separate from intrinsic source rotation. Compose repeated `-90°` and `+90°` operations through the existing normalized page plan; preview and export consume the same delta. Support explicit selected-page and all-page scopes.
- Retain the accepted one-file, 10 MiB input, 200-page and 32 MiB output limits. Selection does not rerender canvases; a rotation invalidates only thumbnails whose requested delta changed. The inherited scheduler remains one active render with an eight-item retained queue.
- Add no production dependency, server processing, persistence, analytics or processing endpoint. Fixed outputs are `extracted-pages.pdf`, `pages-removed.pdf` and `rotated.pdf`; source filenames never enter result names.

## Evidence and consequences

Unit and browser tests cover current-order extraction, exact delete complement, delete-all rejection, repeated selected/all rotation, source/intrinsic rotation composition, geometry retention, output reopen, invalid-source recovery, complete local-only request auditing and cleanup. Independent Poppler inspection reopens representative outputs, reports the expected page counts, crop dimensions and rotations, and renders representative pages.

The focused 200-page desktop/mobile Chromium benchmark records zero canvas rerenders during Select all/Clear selection for all three tools. A selected rotation records one rerender for the affected visible thumbnail and zero for unaffected rendered thumbnails. The inherited scheduler bound is covered by its unit suite. Benchmark timings are development-machine evidence rather than public guarantees or physical-mobile measurements.

The tools do not add range syntax, split groups, multiple outputs, archives, document repair/sanitization, secure erasure or broader document-level bookmark/form/signature preservation promises.
