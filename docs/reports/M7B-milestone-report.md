# M7B Milestone Report: Processor abuse controls

**Date:** 2026-10-22
**Status:** Accepted and merged (`39d954d`)
**Preceding slice:** M7A — CI truth (accepted and merged, `2110313`).
**Decision record:** [ADR-033](../adr/033-m7b-processor-abuse-controls.md).

## Summary

The Word to PDF server now protects itself from one caller using up the shared capacity. Before this slice the server limited what a single job could cost but not how many jobs one caller could ask for: a loop that created empty jobs could fill all 32 slots, and a client that sent one byte a minute could hold a slot for ten minutes. Both are now stopped, uploads are bounded while they arrive, and the server's own replies carry security headers. A person who is being slowed down is told to wait, not that the server is down.

Nothing changes for normal use: one person converting one document at a time never gets near any limit.

## What was implemented

- **Rate limit on starting a job.** Per client: 6 at once, then one more every 10 seconds. Over it: HTTP 429 `rate_limited` with a `Retry-After` header.
- **Cap on active jobs per client.** At most 3 jobs created, uploading or converting at one time; the fourth gets 429.
- **Unused jobs free their slot early.** A job that has received no bytes for 120 seconds expires, instead of waiting out the full 10 minutes (ADR-032 stays true: never later than 10).
- **Bounded uploads.** The body is written to disk as it arrives and counted. Over 20 MiB: 413, and at once if the declared length already says so. No bytes for 120 s: 408 `upload_stalled`. A slow but moving upload is not cut off, but the job lifetime still ends one that trickles forever.
- **Who is a client.** A keyed hash of the network address with a random per-process key; the address is never stored or logged. IPv6 is grouped by /64. `X-Forwarded-For` is ignored unless `PROCESSOR_TRUSTED_PROXY_HOPS` says how many proxies are in front; then the right-hand entry is used, so a client cannot choose its own identity.
- **Bounded memory.** At most 10,000 clients are tracked; the oldest idle ones are dropped first.
- **Security headers on every API reply:** `nosniff`, no referrer, a CSP that allows nothing and forbids framing, `Cross-Origin-Resource-Policy: same-site`, and `no-store` unless the route set its own (the PDF download does).
- **Web message.** A 429 shows "Too many conversions were started from this connection. Wait a minute, then try again." A 503 (service full) and a network failure still say the server is not available.

## Verification

- **Processor:** 177 tests pass, 1 skipped (a ZIP case this platform cannot build); ruff and mypy strict clean. 58 more than before, covering the limiter (burst, refill, `Retry-After`, bounded table), the client key (IPv4, IPv6, spoofed and trusted `X-Forwarded-For`), the settings (defaults pinned, ranges enforced, idle period below the lifetime) and the API (rate limit, per-client cap, 429 versus 503, oversize streamed and declared, stalled and slow-steady uploads, early expiry, headers on JSON, errors and the PDF).
- **The tests can fail.** I broke the code on purpose in 14 places: no streaming size cap, no declared-length check, trusted hops ignored, leftmost `X-Forwarded-For` trusted, no per-client cap, janitor ignoring the idle period, no progress reset, no `nosniff`, upload guard never released, no create rate limit, bucket allowed past its burst, no `Retry-After`, no stall timeout, IPv6 not grouped. All 14 were caught.
- **Web:** format, lint, types and production build pass. 285 web unit tests pass (3 new). A browser test with a mocked 429 checks the message and that no upload is attempted; the Word to PDF browser tests pass in Chromium (6 of 6).
- **Not verified:** behaviour under real load or through a real reverse proxy; the other four browser projects for the new Word to PDF test (CI runs them on the pull request); the limits with real traffic.

## Known limitations

1. **In memory, one process.** Limits reset on restart and are not shared between replicas.
2. **Address-based.** People behind one shared address share a bucket; an attacker with many addresses is not stopped here.
3. **Deployment-dependent.** `PROCESSOR_TRUSTED_PROXY_HOPS` must match the real deployment (see M8 list in the ADR).
4. **Starting numbers.** The values are conservative guesses to be tuned with traffic.
5. **The page does not retry.** After a 429 the person starts again by hand. Allowing a retry with the same file after a transient error is a possible small follow-up; I did not widen this slice.

## Deviations from plan

None.

## Decisions needed from the Product Owner

1. **Accept M7B**, or tell me what to change.
2. **The numbers.** Burst 6, refill one per 10 s, 3 active jobs, 120 s idle. Say so only if you want different starting values; they are settings, not code.

## Recommended next

**M7C — web security headers and CSP.** Content Security Policy, `nosniff`, referrer and permissions policies and framing rules for the site, with browser tests that every tool journey runs with zero policy violations and that hostile file names render as text. HSTS stays with the edge in M8. I will not start it until you say so.

## Files

- Processor: `app/jobs/limits.py`, `app/jobs/client.py`, `app/security_headers.py` (new); `app/config.py`, `app/errors.py`, `app/jobs/store.py`, `app/jobs/state.py`, `app/jobs/janitor.py`, `app/api/jobs.py`, `app/main.py`.
- Web: `apps/web/components/word-to-pdf/session.ts`.
- Tests: `tests/jobs/test_limits.py`, `test_client.py`, `test_abuse_controls.py`, `tests/test_config.py`, `tests/conftest.py`; `apps/web/tests/word-to-pdf-session.test.ts`, `apps/web/e2e/word-to-pdf.spec.ts`.
- Documents: `docs/adr/033-m7b-processor-abuse-controls.md`, ADR index, governance M7 row; ADR-032 marked accepted and merged (`d599784`).
