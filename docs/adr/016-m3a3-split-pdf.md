# ADR-016: M3A.3 local Split PDF

Date: 2026-10-06

Status: Implemented under the approved M3A.3 gate; owner acceptance pending.

## Authority

The approved M3 plan and M3A.3 implementation instruction apply Roadmap M3A, SRS requirements FR-SPL-001 through FR-SPL-004, applicable FR-GEN requirements, and ADR-012 through ADR-015. This record covers Split PDF only. M3B remains outside this slice.

## Decision

- Publish `/split-pdf` as a `LOCAL`, noindex tool after the full choose, bounded preview, group definition, generation, download and reset flow passes. Reuse the existing preview session, stable page plan, PDF.js preview, structural pdf-lib output validation, worker isolation, cancellation, stale-result guards and Object URL ownership.
- Provide two modes. Range groups accept one-based single pages, ranges and comma-separated combinations; every group produces one PDF. Duplicate or overlapping references inside one group are invalid. Reusing a source page in separate groups is valid. Individual selected pages produce one PDF per selected page in source order.
- Load the source once in the Split worker, generate and reopen every PDF, and expose no output until the whole requested batch validates. One output returns a PDF. Multiple outputs dynamically import `fflate@0.8.3` and produce one stored ZIP with fixed `split-NN.pdf` entries. The application owns and revokes the final Blob URL.
- Use exact, conservative engineering caps from the registry: 20 outputs, 64 MiB combined generated PDFs and 64 MiB final ZIP, in addition to the inherited 10 MiB input, 200-page and 32 MiB per-output limits. These are pre-launch engineering limits, not permanent service promises.
- Add no server processing, upload path, persistence, analytics, alternate PDF engine, generic batch framework, worker pool or source-derived output filename.

## Dependency and packaging decision

`fflate@0.8.3` is pinned exactly and used only by the Split worker when at least two validated outputs require an archive. The package declares MIT, has no runtime dependencies and introduces no AGPL or unknown license. Its upstream license is preserved at `packages/pdf-browser/third-party/fflate-0.8.3-LICENSE.txt`. Production bundle inspection and browser tests identify the dedicated archive chunk and prove it is requested for multi-output ZIP generation but not for single-output Split or unrelated routes.

## Consequences

Pure parser and planner tests cover syntax, page-count checks, same-group overlap, cross-group reuse and output caps. Worker tests cover exact PDF/ZIP semantics, atomic failure, byte caps and cancellation. Product tests cover fixed filenames, exact page identity/geometry/rotation, accessibility, local-only requests, invalid-source recovery, URL and worker cleanup, and desktop/mobile behavior. ZIP storage uses level 0 because copied PDF streams are already compressed; this bounds CPU and makes the archive cap closely track retained output bytes.

Split does not preserve document-level bookmarks, signatures or form semantics beyond the existing structural page-copy contract. Cancellation is cooperative between output boundaries; synchronous archive creation cannot be interrupted mid-call, so a cancellation observed immediately after it returns still prevents publication.
