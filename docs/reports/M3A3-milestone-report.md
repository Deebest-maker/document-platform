# M3A.3 COMPLETION REPORT — Split PDF

Date: 2026-10-11

Status: Retrospectively authored. M3A.3 was implemented, verified and merged under PR #9 on 6 October 2026 and accepted by the owner at that time; this closeout report is written on 11 October 2026 during the M3B.2 acceptance cycle to repair the documentation gap identified by the Claude Cowork onboarding audit. The report draws only on repository-retained evidence (ADR-016, benchmark records, dependency review entries, Git history and the current merged implementation). Specific hosted-CI run identifiers are not reproduced because they are not retained in the repository and this report deliberately does not invent historical evidence.

## Implementation summary

`/split-pdf` provides the complete local flow: choose one PDF, validate, open bounded page previews, define output in one of two modes, generate the batch locally, and download either one PDF or a single stored ZIP of `split-NN.pdf` entries. The registry lists Split as `LOCAL` and `available`, retains the accepted PDF type, and carries the engineering caps described below. The route is noindex while the product remains pre-launch.

Two modes are supported:

- Range groups accept one-based single pages, inclusive ranges and comma-separated combinations. Each group produces one PDF. Duplicate or overlapping references within one group are invalid. Reusing a source page across different groups is valid.
- Individual selected pages produce one PDF per selected page in source order.

The UI exposes truthful idle, preview-loading, ready, exporting, success and recoverable error states. Export copy follows the real reading, transforming and validating phases without a fabricated percentage. Conflicting edits and duplicate export are disabled while exporting; cancellation leaves the current plan recoverable where safe.

## Reuse, architecture and new code

M3A.3 reuses the M2B/M3A foundations: the PDF.js preview session, stable page IDs (`session UUID + 1-based source page`), the bounded thumbnail scheduler, the structural page-operation worker, reopened-output validation, safe finite errors, cancellation, generation guards and Blob/Object URL cleanup. No second PDF engine, workflow framework or generic batch runner was introduced.

New code is concentrated in:

- `apps/web/app/split-pdf/page.tsx` and `apps/web/components/split/split-workspace.tsx` for the route and workspace.
- `packages/pdf-browser/src/split-plan.ts`, `split-operations.ts`, `split-client.ts`, `split.worker.ts`, `split-types.ts` for the plan parser, planner, worker bridge and worker.
- `packages/pdf-browser/tests/split-plan.test.ts`, `split-operations.test.ts`, `split-worker.test.ts` for engine tests.
- `apps/web/e2e/split.spec.ts` for the product browser suite.
- `docs/adr/016-m3a3-split-pdf.md`, `docs/benchmarks/M3A3-split.md`, `docs/benchmarks/M3A3-split-results.json` for the decision record and recorded evidence.

The Split worker loads the source once, generates and reopens every PDF, and exposes no output until the whole requested batch validates. One output returns a PDF; two or more outputs dynamically import `fflate@0.8.3` and produce one stored ZIP (`split-NN.pdf` entries, level 0). The application owns and revokes the final Blob URL. ADR-016 records the decision and ZIP-storage choice (stored, not deflated, because copied PDF streams are already compressed, bounding CPU and tying archive size closely to retained output bytes).

## Correctness and independent PDF evidence

Pure parser and planner tests cover syntax, page-count checks, same-group overlap, cross-group reuse and output caps. Worker tests cover exact PDF/ZIP semantics, atomic failure, byte caps and cancellation (deterministic unit and worker tests separately cover cooperative cancellation during a batch and cancellation before archive publication). Product tests cover fixed filenames, exact page identity/geometry/rotation, accessibility, local-only requests, invalid-source recovery, URL and worker cleanup, and desktop/mobile behaviour.

`zipSync` is synchronous, so cancellation cannot interrupt the archive call itself; a cancellation observed after the call still suppresses the result. This limitation is covered by test and documented honestly in ADR-016.

## Resource lifecycle and cancellation

The route inherits the one owned PDF.js worker, one short-lived structural worker during export, the one-active render / eight-retained-queue scheduler and the 200-page preview ceiling. Replacement, reset, pagehide, unmount and navigation cancel or settle owned work, destroy workers, clear canvases and release source references, and revoke owned result URLs. Generation guards prevent stale source, render or export callbacks from publishing into the current session.

## Privacy and security evidence

The complete choose → preview → define groups → export → download → reset journey is request-audited. All observed requests are same-origin GETs with no body. Document bytes, synthetic sensitive filenames and content canaries do not appear in URLs, headers, request bodies or console output; no WebSocket, FastAPI call, processing mutation, third-party request, local storage, session storage or IndexedDB is created. PDF.js worker, font, CMap and codec assets remain application-origin and route-local. Unrelated product routes continue to load zero PDF.js/font assets. Fixed output filenames (`split-01.pdf` … `split-NN.pdf`, archive `split.zip`) never incorporate source filenames.

## Dependencies and licensing

M3A.3 introduces exactly one new runtime dependency: pinned `fflate@0.8.3` (MIT, no runtime dependencies, browser ESM entry `esm/browser.js`). The upstream notice is preserved at `packages/pdf-browser/third-party/fflate-0.8.3-LICENSE.txt`. The package is imported dynamically inside the Split worker only after multiple PDF outputs validate. Production bundle inspection confirms the archive chunk is absent from unrelated routes and single-output Split generation. The reviewed npm archive integrity, SHA-256 and license evidence are retained in `docs/dependency-review.md` under the M3A.3 entry.

The M3A.3 cycle also absorbed one CI security refresh: `GHSA-wq5f-xc86-pv6w` affecting `sharp` < 0.35.5 was addressed by a workspace override pinning `sharp@0.35.5` (Apache-2.0) within Next.js's compatible optional range. The lockfile refresh adds no product capability or document-processing path.

No AGPL dependency is introduced. The existing PDF.js, OFL-font and pdf-lib reviews remain unchanged.

## Engineering limits

Registry caps for Split:

- Inherits the shared single-file / 10 MiB / 32 MiB combined / 200-page / 32 MiB per-output limits.
- Adds `maxOutputs: 20`, `maxCombinedOutputBytes: 64 MiB`, `maxArchiveBytes: 64 MiB`.

These are evidence-based engineering limits and remain subject to physical-device validation; they are not final public launch limits.

## Benchmark observations

Reproduced from `docs/benchmarks/M3A3-split.md` and `M3A3-split-results.json`:

- Desktop Chromium loaded the 200-page plan in 487 ms and generated/validated/archived 20 outputs in 932 ms.
- Emulated mobile Chromium loaded in 1,101 ms and generated the same archive in 1,584 ms.
- Each run produced 581,680 combined PDF bytes and a 583,702-byte ZIP containing the exact 20 fixed-name entries.
- Both viewports showed no horizontal overflow and emitted only first-party GET requests without request bodies.
- Chromium's coarse `performance.memory` counter reported no observable delta at the two sample points; the retained payload evidence is the combined PDF and final archive byte count. Mobile rows are emulation on desktop Chromium, not physical-device measurements.

## Materially changed files/modules (as merged into `main` through PR #9)

- Product route and workspace: `apps/web/app/split-pdf/page.tsx`, `apps/web/components/split/split-workspace.tsx`.
- Engine: `packages/pdf-browser/src/split-plan.ts`, `split-operations.ts`, `split-client.ts`, `split.worker.ts`, `split-types.ts`.
- Shared infrastructure: minor adjustments to `packages/pdf-browser/src/preview/index.ts` and `page-model.ts` where required by the shared contract.
- Registry: `packages/tool-registry/src/catalog.ts` flipped `split-pdf` from `planned` to `available` and added the Split-specific caps.
- Tests: `packages/pdf-browser/tests/split-plan.test.ts`, `split-operations.test.ts`, `split-worker.test.ts`, helpers `tests/helpers/zip-assertions.ts`, and `apps/web/e2e/split.spec.ts`.
- Governance and evidence: `docs/adr/016-m3a3-split-pdf.md`, `docs/dependency-review.md` (M3A.3 and the sharp CI closeout entries), `docs/benchmarks/M3A3-split.md`, `docs/benchmarks/M3A3-split-results.json`, `packages/pdf-browser/third-party/fflate-0.8.3-LICENSE.txt`.
- Fixtures authoring remained the existing optional local tool set; no new production or CI dependency was introduced beyond `fflate`.

The processor source and `.github/workflows/ci.yml` were unchanged by this slice.

## Verification status

Required `web`, `processor` and `processor-container` GitHub Actions checks passed on the PR before merge (branch protection enforces those three identifiers). The PR head immediately before squash merge is recorded in Git as `63545db` (branch tip of `codex/m3a3-split-pdf`); the merge is `a91ec89 M3A.3: local Split PDF workflow (#9)` on `main`. The exact hosted CI run numbers from the merge window are not retained in the repository and are deliberately not reproduced here.

Local verification during the slice: `pnpm check` (format, lint, type, unit/integration, build, Chromium smoke E2E) and `pnpm test:foundation` passed; `pnpm audit --audit-level=high` and `uv audit --locked` reported no known vulnerabilities. The exact pass counts recorded by Codex at merge time are not retained in the repository.

## Deviations, limitations and unresolved issues

No unapproved architecture, dependency, processing-location or scope deviation. `fflate@0.8.3` was the one new production dependency, added under explicit review, pinned exactly and used only inside the Split worker when a multi-output ZIP is required.

Split does not provide:

- document-level bookmark, form or signature preservation beyond the existing structural page-copy contract;
- repair/sanitisation of damaged PDFs;
- secure-erasure guarantees;
- cancellation inside the synchronous `zipSync` call itself (cooperative between output boundaries only).

Physical-mobile verification remains a launch gate; the current caps are engineering controls, not public guarantees.

Implementation head immediately before merge: `63545db` on `codex/m3a3-split-pdf`. Merged into `main` as squash commit `a91ec89 M3A.3: local Split PDF workflow (#9)`.

## Recommended next milestone

After owner acceptance (recorded), proceed only to M3B.1 — Images to PDF. Do not begin M3B.2 or any other slice before explicit approval.
