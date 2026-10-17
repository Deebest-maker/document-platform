# M3 Milestone Report — Local PDF toolkit (M3A + M3B)

**Status:** IMPLEMENTATION COMPLETE — PRODUCT OWNER ACCEPTANCE PENDING for M3B.3 and M3B.4; prior sub-milestones already accepted and merged
**Branch (current slice):** `feat/m3b-complete-local-tools`
**Reporter:** Claude (Cowork session)
**Date:** 2026-10-12

## 1. Why this report exists

M3 ("Local PDF toolkit") grew the browser-only tool set from three (M2A Merge, M2B foundation) to ten by the close of M3B.4. Each sub-milestone shipped behind its own gate and its own ADR. This report is the single-page closeout that summarises what M3 delivered, so a Product Owner reviewing the milestone can see the shape of the whole thing without re-reading nine ADRs.

M4 is **not** opened by this report. Compress PDF, Word → PDF and PDF → Word remain `planned`. No server document endpoint, authentication, database or queue was added. The platform's processing boundary (local-first for every tool M3 shipped) is unchanged.

## 2. The sub-milestones, in order

| Sub-milestone | Tool                  | Route                                                    | ADR     | Status                                            |
| ------------- | --------------------- | -------------------------------------------------------- | ------- | ------------------------------------------------- |
| M3A.1         | Organize PDF          | `/organize-pdf`                                          | ADR-014 | Accepted and merged                               |
| M3A.2         | Extract/Delete/Rotate | `/extract-pdf-pages`, `/delete-pdf-pages`, `/rotate-pdf` | ADR-015 | Accepted and merged                               |
| M3A.3         | Split PDF             | `/split-pdf`                                             | ADR-016 | Accepted and merged                               |
| M3B.1         | Images to PDF         | `/jpg-to-pdf`                                            | ADR-017 | Accepted and merged                               |
| M3B.2         | PDF to JPG            | `/pdf-to-jpg`                                            | ADR-018 | Accepted and merged (owner tested 2026-10-11)     |
| M3B.3         | PDF to Text           | `/pdf-to-text`                                           | ADR-019 | Implementation complete; owner acceptance pending |
| M3B.4         | Remove PDF Metadata   | `/remove-pdf-metadata`                                   | ADR-020 | Implementation complete; owner acceptance pending |

## 3. Shared architecture that held across M3

- **One PDF engine.** `pdf-lib@1.17.1` for structural work, `pdfjs-dist@6.3.289` for preview and raster, `fflate@0.8.3` (dynamic import) for ZIP packaging. No engine was changed, replaced or supplemented during M3.
- **One font substitution.** OFL-licensed Liberation Sans 2.1.5 for PDF.js's missing standard fonts. First-party assets, no remote font requests.
- **One preview document.** `packages/pdf-browser/src/preview` owns the busy-page lock, cancellation points and clean-up for every page-based tool. M3B.3 extended it with an `extractText({sourcePageNumber})` method that returns `{text: string}`; this preserved the existing contract for M3A and did not change behaviour for any already-merged tool.
- **One stable page ID.** `session UUID + 1-based source page number` across Organize, Extract, Delete, Rotate, Split, PDF to JPG. Metadata removal does not use page IDs (it works at the document level), but its verification step uses the same media-box/rotation comparison idiom.
- **One privacy budget.** Every tool is `LOCAL`. Every tool's E2E spec audits network requests for cross-origin traffic and canary-string leaks and asserts both are zero. No document bytes, filenames or extracted strings reach any server, log, console or analytics.
- **One disclosure habit.** Every tool whose output deserves a caveat says so in the route page before file selection — PDF to JPG's rasterisation note, PDF to Text's OCR-not-performed note, Remove PDF Metadata's not-secure-redaction note.
- **One benchmark pattern.** Each tool has a `apps/web/benchmarks/run-<slug>.mjs` runner, a `docs/benchmarks/M3B<n>-<slug>.md` document, and a `docs/benchmarks/M3B<n>-<slug>-results.json` written by the runner. The schema is committed; the numbers are produced by CI or the Product Owner's local run.

## 4. What M3 added to the engineering surface

- 7 new routes (`/organize-pdf`, `/extract-pdf-pages`, `/delete-pdf-pages`, `/rotate-pdf`, `/split-pdf`, `/jpg-to-pdf`, `/pdf-to-jpg`, `/pdf-to-text`, `/remove-pdf-metadata`).
- 7 new ADRs (ADR-014 through ADR-020).
- 1 new runtime dependency across the entire milestone: `fflate@0.8.3`, exact version, locked, under MIT, dynamically imported — see ADR-016 and the dependency-review entry.
- 1 new development dependency: `@axe-core/playwright@4.13.0`, locked, under MPL-2.0, used by E2E accessibility assertions.
- 1 CI security refresh pinning `next@16.3.8` and `eslint-config-next@16.3.8` after a GHSA-cjq9-62q9-8jv4 advisory, with no behavioural change.
- 0 new production backend endpoints.
- 0 new infrastructure (no DB, no cache, no queue, no object store, no auth).

## 5. Privacy posture at the close of M3

The platform-wide posture is unchanged and stronger than at M2's close.

- Every tool shipped in M3 processes bytes entirely in the browser.
- Every tool's E2E spec includes a privacy audit of outbound requests and console messages for canary leakage.
- Engines return structural data, never raw strings. Metadata removal in particular never surfaces raw titles, authors or XMP contents through its result — only flags, counts and key names.
- The privacy page lists every available tool, states which processing mode each uses, and names the one shipped qualifier (Remove PDF Metadata is not secure redaction).
- `/pdf-to-jpg` and `/pdf-to-text` carry their own route-level disclosures (rasterisation vs. vector; OCR-not-performed); `/remove-pdf-metadata` carries the not-secure-redaction note before any upload.

## 6. Known limits reported truthfully

Each tool's limits live in `packages/tool-registry/src/catalog.ts`. The shared `localPageLimits` is 10 MiB input, 200 pages, 32 MiB output. Tools override only what their own ADR justifies. All limits are engineering caps, not launch guarantees, and are subject to physical-device validation.

- **PDF to JPG**: 50 selected pages, 25 MP per page, 220 MP total, 64 MiB JPG bytes, 64 MiB ZIP.
- **PDF to Text**: 2,000,000 characters, 8 MiB UTF-8 output, 20,000-character preview cap.
- **Remove PDF Metadata**: inherits `localPageLimits`; trailer /ID removal is a SPIKE and reported truthfully.

## 7. CI gate at the close of M3

Three required GitHub Actions jobs: `web`, `processor`, `processor-container`. Each slice in M3 merged under the same gate. The current slice (`feat/m3b-complete-local-tools`, carrying M3B.3 + M3B.4 + this closeout) must pass the same gate before merge.

## 8. What is left before M3 can be closed

1. Product Owner manual acceptance of **M3B.3 PDF to Text** at `http://127.0.0.1:3000/pdf-to-text`.
2. Product Owner manual acceptance of **M3B.4 Remove PDF Metadata** at `http://127.0.0.1:3000/remove-pdf-metadata`.
3. Branch `feat/m3b-complete-local-tools` reaches GitHub (via the Product Owner's Windows PowerShell block in the final combined report).
4. All three required CI jobs pass on the branch.
5. The branch is merged into `main`.

Only steps 1 and 2 remain within the Product Owner's hands; the implementation side of M3 is complete.

## 9. What M4 would open (NOT in this session)

M4 would introduce the first server-involved tool paths — Compress PDF (HYBRID), Word → PDF (SERVER) and PDF → Word (SERVER) — with the server-side engines, retention policy, abuse controls and legal review their ADRs will record. None of that is approved in M3's gate.

M3 does not change M4's starting conditions.

## 10. Links

- Milestone reports:
  - [M3A.3 — Split PDF](M3A3-milestone-report.md) (retrospective)
  - [M3B.1 — Images to PDF](M3B1-milestone-report.md) (retrospective)
  - [M3B.2 — PDF to JPG](M3B2-milestone-report.md)
  - [M3B.3 — PDF to Text](M3B3-milestone-report.md)
  - [M3B.4 — Remove PDF Metadata](M3B4-milestone-report.md)
- Decision records: [`docs/adr/README.md`](../adr/README.md)
- Dependency review: [`docs/dependency-review.md`](../dependency-review.md)
- Benchmarks: [`docs/benchmarks/`](../benchmarks/)
