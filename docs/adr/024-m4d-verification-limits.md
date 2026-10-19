# ADR-024: M4D Verification, Benchmark-Derived Limits & Hardening

**Status:** Implemented under the approved M4D gate; Product Owner acceptance pending
**Date:** 2026-10-19
**Milestone:** M4D — Verification & Closeout
**Scope:** `services/processor/app/` (gate, janitor, store, config, upload route, PDF page bound), `services/processor/tools/m4d_benchmark.py`, `apps/web/components/word-to-pdf/api.ts`, `apps/web/next.config.ts`; matching tests; `docs/benchmarks/M4D-*`.

## Context

M4A–M4C delivered the job core, the LibreOffice adapter and the Word-to-PDF product slice with provisional limits. Governance §9 and §11 require that numeric limits come from real benchmarks and that the milestone closes with a full regression and an end-to-end run before the Product Owner accepts it.

M4D therefore did two things: it measured the pipeline (`docs/benchmarks/M4D-libreoffice.md`), and it ran the whole product for real (processor + built web app + browser) instead of only through unit tests with mocks. The real run found four defects that mocked tests could not. All four are fixed here.

## Decisions

### 1. Conversions run one at a time (new `ConversionGate`)

Governance §9.3 says exactly one on-disk conversion at a time, but M4B/M4C did not enforce it: concurrent `POST /convert` calls ran concurrently. `app/jobs/gate.py` adds a single-slot gate with a bounded wait and a bounded queue:

- One `asyncio.Semaphore(1)` slot.
- A caller waits at most `convert_queue_wait_seconds` (default **20 s**) and is then told `503 not_ready`; the job stays untouched and the client may retry.
- At most `max_inflight_jobs` (32) callers may wait; beyond that the answer is an immediate 503.
- Callers are authorized **before** they may queue, and the job is re-checked once the slot is won (it may have been deleted or started while waiting). Unauthenticated callers never touch the gate.

The 20 s wait is about ten W3-size conversions or about one W8 (1,000-page) conversion. Serialized capacity is about 0.5 conversions per second per processor.

**Concurrency stays at 1.** The M4B gate says "consider more than 1 if W3 < 2 s". W3 measured 1.97 s, a marginal pass. Running two at once gives about 1.75× throughput on 2 vCPU but doubles memory and departs from the governance baseline. Not worth deciding on one host that is not the production image; revisit with M8 staging numbers.

### 2. Retention is now actually enforced: the janitor expires jobs in every state

**Defect found in the real run.** The janitor only removed workspaces of _terminal_ jobs. A job that was created or uploaded but never converted (closed tab, crash, lost network) was treated as active forever: its uploaded bytes stayed on disk and its registry entry stayed in memory. Two consequences: the "deleted automatically" privacy statement was not true for abandoned uploads, and 32 abandoned jobs would lock out job creation until a processor restart (503 on every new job).

**Fix.** `Janitor.sweep()` now expires any job whose last state change is older than `job_lifetime_seconds`, whatever its state: it removes the workspace, drops the registry entry (which frees the in-flight slot) and fires the job's cancel event. Orphan workspaces with no registry entry are still removed. Young active jobs are untouched.

**Safety guard.** Because expiry now applies to running jobs, `Settings` refuses to start if `job_lifetime_seconds <= runner_timeout_seconds + convert_queue_wait_seconds` (defaults: 900 s vs. 140 s). A job can therefore never be expired while a legitimate conversion is still running.

**Related fix.** An upload whose body is still arriving when its job expires now returns 404 and removes the workspace it just created, instead of surfacing a 500 and leaving an orphan until the next sweep.

**Verified on a real filesystem** (processor with a 6 s lifetime and 2 s sweep): three abandoned jobs blocked the fourth with 503; after expiry the fourth was created (201); an abandoned upload's directory was deleted and a later `GET` returned 404.

### 3. Limits: evidence and decisions

| Limit                     | Was    | Now        | Evidence / reasoning                                                                                                                                                                                                                                                      |
| ------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Max input                 | 20 MiB | **20 MiB** | A 19 MiB document converts in 2.4 s at 251 MiB RSS, and even 50 MiB converts in 2.9 s at 361 MiB. Performance does not force the limit; it stays a product and abuse-cost choice. PO may raise it later (needs a matching proxy limit).                                   |
| Max output                | 32 MiB | **32 MiB** | Largest measured output is 4.6 MiB (1,018 pages). Large headroom, no reason to change.                                                                                                                                                                                    |
| Runner timeout            | 120 s  | **120 s**  | Slowest legitimate case is 15.5 s; about 8× headroom while still bounding a hung LibreOffice.                                                                                                                                                                             |
| Page-count bound (output) | 10,000 | **2,000**  | A 1,018-page document converts in 14 s (13.7 ms/page). The M4B formula (2× observed, capped at 1,000) predates having a 1,000-page measurement and would reject a legitimate 1,018-page document, so the bound is 2× the largest measured (2,036), rounded down to 2,000. |
| Conversion queue wait     | none   | **20 s**   | See decision 1.                                                                                                                                                                                                                                                           |
| Job lifetime (janitor)    | 15 min | **15 min** | Unchanged; **needs Product Owner approval** (see "Retention options" below).                                                                                                                                                                                              |
| Max in-flight jobs        | 32     | **32**     | Unchanged. Bounds memory held by queued uploads (32 × 20 MiB).                                                                                                                                                                                                            |

### 4. Web client now understands processor errors

**Defect found in the real browser run.** The processor returns errors as `{"detail": {"code": "limit_exceeded", "message": …}}` (FastAPI). The client expected a top-level, upper-case `{code, message}`, so it never recognised a processor error: a too-big file showed a generic failure instead of the "file too large" message. `parseProcessorError` in `api.ts` unwraps the real envelope, upper-cases the code, and is covered by contract tests for all eight codes plus every non-matching shape (old top-level shape, validation-error list, non-JSON proxy errors).

### 5. Next.js dev/preview proxy no longer breaks real uploads

**Defect found in the real browser run.** Next's rewrite proxy defaults to a 10 MB request body (excess is truncated and the upload then hangs) and a 30 s timeout (a long conversion outlives it). `next.config.ts` now sets `proxyClientMaxBodySize: 25mb` (processor limit plus headroom so an oversize file still reaches the processor and gets a clean 413) and `proxyTimeout: 150 s` (runner timeout + queue wait + margin). Verified: 19 MiB uploads succeed; 21 MiB gets a clean 413 with the right message. Production is expected to be a same-origin reverse proxy (governance §9.3); the same two numbers are the requirement for it (see deployment requirements).

## Retention options (Product Owner decision required)

Normal flow deletes the job a few seconds after download. The janitor lifetime only governs abandoned or undownloaded jobs, and worst-case residence is **lifetime + sweep interval (60 s)**.

| Option                  | Worst-case residence | Trade-off                                                                                                                                           |
| ----------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. 15 min (current)** | about 16 min         | Most forgiving for slow connections and a user who steps away before downloading. Longest time private bytes sit on the server after abandonment.   |
| B. 10 min               | about 11 min         | Shorter exposure; still far above the slowest measured conversion (15.5 s). Slightly more risk for a user returning to download after a long pause. |
| C. 5 min                | about 6 min          | Strongest privacy story; the user must download promptly. Still above the config floor (140 s) and above any measured conversion.                   |

Hard floor enforced by config: more than runner timeout + queue wait (140 s). Engineering recommendation: **A or B**; either is defensible. This ADR keeps A until the Product Owner chooses. A job whose upload takes longer than the lifetime (a 20 MiB file on a link below roughly 0.2 Mbit/s for A) is expired mid-upload and the user simply retries.

## Deployment requirements recorded for M8 (not enforced here)

- Processor container memory **≥ 1.5 GiB** (2× the pixel-bomb engine-only peak of 612 MiB, plus the API process); **≥ 2 vCPU**.
- Jobs-root volume **≥ 1 GiB** (32 queued uploads × 20 MiB plus one conversion workspace of up to 40 MiB).
- Reverse proxy: request-body limit **≥ 25 MiB** and read timeout **≥ 150 s** on the processor route.
- Re-run `tools/m4d_benchmark.py` inside the production image before launch and compare against `docs/benchmarks/M4D-libreoffice-results.json`.

## Deferred (explicitly not done in M4D)

- Image-dimension preflight and an address-space rlimit for LibreOffice (M7 hardening).
- Fidelity regression set built from real Word documents (M7); M4D provides a manual acceptance script instead.
- Benchmarks inside the production container image (M8).
- Raising concurrency above 1 (needs production-image data).

## Consequences

- The Word-to-PDF route now has the guarantees the privacy copy already claims: single conversion at a time, abandoned uploads deleted, no job-creation lock-out, and errors that reach the user as intended.
- Capacity is deliberately modest (about 0.5 conversions/s per processor). Scaling is horizontal (more processors) in a later milestone, not concurrency inside one.
- The page-count bound is tighter than before (10,000 → 2,000), which is intentional.

## Verification

Processor: 118 tests pass (new: gate, expiry, config guard, page bound, upload-expiry). Web: 233 unit tests pass (new: client error-contract tests); lint, typecheck, format and production build clean; word-to-pdf, shell, discovery and privacy E2E specs pass in desktop and mobile Chromium. Real-stack run: processor with LibreOffice + built web app + browser, covering successful conversion, oversize rejection and concurrent requests. CI additionally builds and runs the restricted processor container (read-only, all capabilities dropped, uid 10001).
