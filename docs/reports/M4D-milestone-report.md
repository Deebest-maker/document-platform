# M4D Milestone Report: Verification & Closeout

**Date:** 2026-10-19
**Status:** Implementation complete; awaiting Product Owner acceptance.
**Preceding milestone:** M4C — Product Slice & Retention Policy (merged).
**Decision record:** [ADR-024](../adr/024-m4d-verification-limits.md). **Evidence:** [`M4D-libreoffice.md`](../benchmarks/M4D-libreoffice.md), [`M4D-libreoffice-results.json`](../benchmarks/M4D-libreoffice-results.json).

## Summary

M4D measured the Word→PDF pipeline, ran the whole product for real (processor + LibreOffice + built web app + browser), and fixed everything that run exposed. Four real defects were found that unit tests with mocks could not catch; all are fixed and tested.

## Defects found in the real run, and fixed

| #   | Defect                                                                                                        | Impact                                                                                                    | Fix                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Conversions were not serialized; governance §9.3 says one at a time.                                          | Concurrent requests ran concurrently: memory spikes and a broken baseline.                                | `ConversionGate`: one slot, 20 s bounded wait, bounded queue, 503 retry.                                            |
| 2   | Janitor only removed terminal jobs. Abandoned (created/uploaded, never converted) jobs lived forever.         | Uploaded bytes never deleted (privacy copy untrue); 32 abandoned jobs blocked all new jobs until restart. | Jobs now expire by age in every state; config guard keeps lifetime above any conversion; mid-upload expiry handled. |
| 3   | Web client could not read processor errors (wrong envelope and letter case).                                  | Every server error showed a generic failure, e.g. no "file too large" message.                            | `parseProcessorError` plus contract tests for all error codes.                                                      |
| 4   | Next.js proxy defaults (10 MB body, 30 s timeout) silently truncated bigger uploads and cut long conversions. | Uploads over 10 MB hung; slow conversions failed.                                                         | Proxy set to 25 MB / 150 s. 19 MiB OK; 21 MiB gets clean 413.                                                       |

## Measured results (summary)

Host: dev container, 2 vCPU, LibreOffice 24.2 — **not the production image**. Full tables in the benchmark doc.

- Cold start floor: 1.25 s (smallest document).
- Typical 50-page document: 2.1 s end to end. 200 pages / 10 MiB: 3.8 s. 19 MiB: 2.4 s. 50 MiB: 2.9 s.
- 1,018-page document: 15.5 s (13.7 ms per page). Peak memory ~280 MiB.
- Hostile inputs (macro, encrypted, ZIP bomb, legacy .doc, traversal, empty): all rejected in under 3 ms.
- Pixel bomb past preflight (engine-only): 612 MiB peak, 5.4 s, no failure.
- Serialized capacity: about 0.5 conversions per second per processor.

## Limits decided

| Limit            | Value                     | Basis                                                    |
| ---------------- | ------------------------- | -------------------------------------------------------- |
| Max input        | 20 MiB (unchanged)        | Not performance-bound; product/abuse choice.             |
| Max output       | 32 MiB (unchanged)        | Largest measured output 4.6 MiB.                         |
| Runner timeout   | 120 s (unchanged)         | Slowest legitimate case 15.5 s.                          |
| Page-count bound | 2,000 (was 10,000)        | 2× the largest measured document.                        |
| Queue wait       | 20 s (new)                | About ten typical conversions.                           |
| Concurrency      | 1 (unchanged)             | Governance baseline; revisit with production-image data. |
| Job lifetime     | 15 min — **PO to decide** | See "Decision needed" below.                             |

## Verification

- Processor: ruff, mypy and 118 pytest tests pass (new tests for gate, expiry, config guard, page bound, mid-upload expiry).
- Web: format, lint, typecheck, production build clean; 233 unit tests pass; word-to-pdf, shell, discovery and privacy E2E pass (132 runs, desktop + mobile Chromium).
- Real stack: curl and browser runs against the actual processor with LibreOffice and the built web app.
- Janitor on a real filesystem: 3 abandoned jobs blocked a 4th (503); after expiry the 4th was created; an abandoned upload's directory was deleted and its job returned 404.
- Auth: unauthorised callers get 401 and never reach the conversion gate (tested).
- Container: CI builds the processor image and runs it hardened (read-only, all capabilities dropped, uid 10001) for liveness. **A conversion inside the container was not exercised in this environment** (no Docker daemon).

## Known limitations (honest list)

1. Benchmarks were not run in the production image. Re-run before launch (M8).
2. The synthetic corpus cannot judge fidelity. Fonts: the image carries Liberation fonts, so Calibri/Times documents are rendered with metric-compatible substitutes. Real-document fidelity is checked by the acceptance script below, and a fixture set is planned for M7.
3. Pixel-bomb defence relies on the ZIP-ratio check. Image-dimension preflight and a LibreOffice memory rlimit are deferred to M7.
4. A hardened (read-only) container needs a writable jobs volume and temp space for conversions; this must be verified in M8.
5. An upload that takes longer than the job lifetime (about 0.2 Mbit/s for 20 MiB at 15 min) is expired mid-upload; the user retries.
6. M4C merged with provisional limits. The tool is not publicly deployed until M8, so no user has been exposed to them.
7. Deployment requirements for M8: container memory ≥ 1.5 GiB, ≥ 2 vCPU, jobs volume ≥ 1 GiB, reverse proxy body limit ≥ 25 MiB and read timeout ≥ 150 s.

## Decision needed from the Product Owner

**Retention (job lifetime).** Normal flow deletes the file seconds after download; this value only covers abandoned or undownloaded jobs. Worst-case residence = lifetime + 60 s.

- **A. 15 min** (current) — most forgiving; longest exposure after abandonment.
- **B. 10 min** — modest tightening with little cost to users.
- **C. 5 min** — strongest privacy story; user must download promptly.

Engineering view: A and B are both defensible; the ADR keeps A until you choose. Governance cap is 60 min; the code refuses anything at or below 140 s.

## Manual acceptance script

Use your own real Word files (never sensitive ones for a test run): a simple memo, a rich document (headings, a table, an image, header/footer, page numbers, non-English text if you use it), and a large one (10–19 MiB). Also have a legacy `.doc` and a file over 20 MiB.

**Start the stack (pick one):**

- _Linux or WSL2 (what engineering tested):_ `sudo apt install libreoffice-writer qpdf fonts-liberation2`, then from the repo root: `uv sync --locked --project services/processor`, create an empty jobs folder containing a file named `.document-platform-jobs-root`, then run the processor with `PROCESSOR_JOBS_ROOT=<that folder>` and the uvicorn command in the README. In a second terminal: `pnpm install`, `pnpm build`, `pnpm start`.
- _Docker (closest to production; not exercised by engineering):_ `docker build --tag document-platform-processor:m0 services/processor`, then `docker run --detach --name dp-processor --memory 1536m --publish 127.0.0.1:8000:8000 --volume dp-jobs:/var/lib/document-platform-processor/jobs document-platform-processor:m0`. Then `pnpm build` and `pnpm start`. If the container step fails, send the error; that is a finding, not a mistake on your side.

**Checks** (open `http://localhost:3000/word-to-pdf`):

1. The privacy disclosure is visible before you choose a file.
2. Convert the simple memo: progress shown, "converting" state shown, `word-to-pdf.pdf` downloads and opens; text is correct; the page says the server copy was deleted.
3. Convert the rich document and open it next to Word's own PDF export. Judge: text, headings, table, image, header/footer, page breaks. Expect font substitution differences; report anything beyond that (missing content, broken layout).
4. Convert the large file: it completes without the page hanging.
5. Choose the legacy `.doc`: rejected with a clear message, nothing uploaded.
6. Choose the file over 20 MiB: rejected with a clear "too large" message.
7. Start a conversion and press Cancel: the page returns to a usable state; converting again works.
8. Open the jobs folder (or `docker exec dp-processor ls /var/lib/document-platform-processor/jobs`): after steps 2–7 it contains only the hidden marker file.
9. Abandoned-upload check (about 3 minutes): restart the processor with `PROCESSOR_JOB_LIFETIME_SECONDS=150` and `PROCESSOR_JANITOR_INTERVAL_SECONDS=10` (for Docker, pass them as `--env` flags), upload a file, then close the tab instead of converting. Within roughly three minutes the job folder disappears.
10. Choose retention: A, B or C.

**Acceptance:** all checks pass (or listed differences are accepted) and a retention value is chosen. Merge only after you say so.

## Files

- `services/processor/app/jobs/gate.py`, `janitor.py`, `store.py`; `app/config.py`; `app/api/jobs.py`; `app/main.py`; `app/jobs/validators/pdf.py`
- `services/processor/tools/m4d_benchmark.py` (benchmark harness)
- `apps/web/components/word-to-pdf/api.ts`; `apps/web/next.config.ts`
- Tests: `tests/jobs/test_gate.py`, `test_janitor.py`, `test_upload_expiry.py`, `test_pdf_validator.py`, `tests/test_config.py`, `apps/web/tests/word-to-pdf-api.test.ts`
- Docs: ADR-024, this report, `docs/benchmarks/M4D-*`, governance milestone table, ADR index, M4B methodology banner, README container note

## Recommended next milestone

M5 — Hard Tools / Spikes (compression benchmark and implementation; PDF→Word GO/DEFER). Remaining after M5: M6 Content/SEO, M7 QA/Hardening, M8 Staging/Launch, M9 Monetization.
