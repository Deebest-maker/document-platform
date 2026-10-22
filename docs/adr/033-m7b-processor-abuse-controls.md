# ADR-033: Word to PDF processor abuse controls

**Status:** Implemented under the approved M7 gate; owner acceptance pending
**Date:** 2026-10-22
**Scope:** What the Word to PDF processor does when one caller creates jobs too fast, holds slots it does not use, or sends an upload that is too large, too slow or never ends. Also the headers on the processor's own responses and the one new message the web page shows. No change to the conversion pipeline, validators, limits on file size, endpoints or storage.
**Relates to:** ADR-021 (job core, capability tokens), ADR-024 (limits, single conversion slot, janitor), ADR-032 (10-minute idle retention), governance §9 and §14.3, document 05 §11 (rate limiting) and §19 (launch gates).

## Context

Until now the processor limited what one job could cost (20 MiB input, one conversion at a time, 120 s per conversion, expiry) but not how many jobs one caller could ask for. A script that calls `POST /v1/jobs` in a loop would fill the 32 in-flight slots with empty jobs, and every real visitor would then get "not ready". A client that opens an upload and sends one byte a minute would hold a slot for the full job lifetime. Nothing set response headers on the API itself.

The processor is a single process with an in-memory store (governance §9.3), so the controls can be in memory too. No new dependency.

## Threats addressed

| #   | Threat                                                                                | Control                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | One caller creates jobs in a fast loop                                                | Token bucket per client on `POST /v1/jobs`: burst of 6, then one more every 10 s. Over the limit: `429 rate_limited` with `Retry-After`                                                                                                                             |
| T2  | One caller holds the shared slots with jobs it never uses                             | At most 3 active jobs (created, uploading or converting) per client: `429 rate_limited`. A job that receives no upload bytes for 120 s expires early                                                                                                                |
| T3  | An upload that is too big, too slow, or never ends                                    | Body is streamed to disk and counted as it arrives: `413` at 20 MiB, or at once if `Content-Length` already says so. No bytes for 120 s: `408 upload_stalled`                                                                                                       |
| T4  | A caller pretends to be many clients (or someone else) with `X-Forwarded-For`         | The header is ignored unless `trusted_proxy_hops` says how many proxies are in front; then the entry that many places from the right is used                                                                                                                        |
| T5  | An API response is cached, sniffed into another type, framed, or carries the referrer | Every response gets `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: same-site`, and `Cache-Control: no-store` unless the route set its own |

## Decisions

**1. Who is a "client".** A keyed BLAKE2b hash of the caller's network address, with a random key chosen when the process starts. The address itself is never stored, logged or returned, and the same address cannot be linked across restarts. IPv6 callers are grouped by their /64, because one subscriber typically holds a whole /64 and could otherwise rotate through 2^64 addresses.

**2. Forwarded addresses are opt-in.** `PROCESSOR_TRUSTED_PROXY_HOPS` defaults to 0: the TCP peer is the client and `X-Forwarded-For` is ignored. With N hops, the entry N places from the right is used, because each trusted proxy appends the address it saw and only the right-hand entries were written by our own infrastructure. Anything a client puts on the left is ignored. A wrong value fails in one of two ways, and both are written down for M8: too low lets a caller choose its own identity; zero behind a proxy puts every visitor in one bucket.

**3. Two different refusals.** `429 rate_limited` means "this caller is going too fast or holds too many jobs": the web page says to wait a minute. `503 not_ready` means "the service as a whole is full": the web page keeps its existing "server is not available" message. Telling a person the server is down when they are the one being slowed would send them away from a working service.

**4. Numbers.** A person converts one document at a time and a conversion takes seconds (slowest measured 15.5 s, ADR-032). A burst of 6 and a cap of 3 active jobs leave room for a retry, a second tab, or a household behind one address. The refill of one job per 10 s allows 360 an hour, far above any human use and far below a flood. The 120 s created-idle period is only about no bytes at all: a real upload sends data continuously and resets it with every chunk, so two silent minutes means the caller has gone, and the slot comes back in two minutes instead of ten. These are starting points and are expected to change with real traffic in M8; each is an environment setting with a validated range.

**5. Progress counts.** Every received chunk resets the created-idle clock, so a slow but moving upload of the largest allowed file is not cut off. The job lifetime (10 minutes, ADR-032) still caps a job that trickles bytes forever, and a test pins this.

**6. The limiter is bounded.** At most 10,000 clients are remembered. Past that, fully refilled entries are dropped first, then the least recently used. A flood of distinct addresses therefore cannot grow memory without limit.

**7. Headers by middleware.** Written once, as pure ASGI middleware that never buffers a body, so a new route cannot forget them. The PDF download keeps its own `Cache-Control`.

## What changed

- `services/processor/app/jobs/limits.py` (token bucket), `app/jobs/client.py` (client key), `app/security_headers.py` (middleware), all new.
- `app/config.py`: six settings with validated ranges (`created_job_idle_seconds` at least 30 and below the job lifetime, burst, refill, per-client cap, client table size, trusted hops 0 to 5) and their environment variables.
- `app/jobs/store.py`: per-client active count checked under the store lock. `app/jobs/janitor.py`: a job still in `created` expires after the idle period, others after the lifetime. `app/errors.py`: `rate_limited` (429), `upload_stalled` (408), and `Retry-After` on 429. `app/api/jobs.py`: rate check on create, streamed bounded upload. `app/main.py`: wiring.
- `apps/web/components/word-to-pdf/session.ts`: a 429 from the processor shows "Too many conversions were started from this connection. Wait a minute, then try again." instead of "server not available".

## Evidence

- Processor: 177 tests pass, 1 skipped (a ZIP case the platform's `zipfile` cannot build); ruff and mypy (strict) clean. 58 new tests across limiter, client key, config and the end-to-end behaviours: burst, refill, `Retry-After`, a spoofed `X-Forwarded-For`, trusted hops, per-client cap, 429 versus 503, oversize body (streamed and declared), stalled upload, slow but steady upload, early expiry of an unused job, security headers on JSON, errors and the PDF download.
- Fourteen deliberate breakages, each caught by a test: no streaming size cap, no declared-length check, trusted hops ignored, leftmost `X-Forwarded-For` trusted, no per-client cap, janitor ignoring the idle period, no progress reset, no `nosniff`, upload guard never released, no create rate limit, bucket allowed to exceed its burst, no `Retry-After`, no stall timeout, IPv6 not grouped.
- Web: 276 unit tests pass (3 new: a 429 body, a bare proxy 429, a 503 staying "server unavailable"). A mocked-processor browser test shows the new message and no upload request. Word to PDF browser tests pass in Chromium.

## Not covered, and limits

1. **In memory, one process.** The tables vanish on restart and are not shared between replicas. Running more than one processor needs a shared store; the governance single-worker rule still holds.
2. **Address-based.** Many people behind one address (an office, a mobile carrier's shared address) share a bucket. A determined attacker with many addresses is not stopped by this layer; edge limits and, if needed, a challenge belong to M8.
3. **Only the processor is covered.** The static site, the web server's own limits, request-body and header-size limits and timeouts of the reverse proxy, TLS and HSTS are M8 deployment items.
4. **Conversion itself.** The converter's network isolation and resource limits are unchanged from ADR-022 and ADR-024.
5. **Not measured under load.** The tests prove behaviour, not capacity. A load test against the real container is an M8 item.
6. **The web page does not wait for you.** After "Wait a minute" it does not count down or retry by itself.

## M8 checklist created by this record

- Set `PROCESSOR_TRUSTED_PROXY_HOPS` to the real number of proxies. Check it with a request through the deployed path: two different visitors must not share a bucket and one visitor must not be able to choose its own.
- Reverse proxy: maximum body at or above 20 MiB and no more, header and body read timeouts, and no buffering of whole uploads to a second disk.
- HSTS and TLS settings at the edge. Monitoring and an alert on the 429 rate, the 503 rate and a stuck cleanup.
- Re-tune burst, refill, per-client cap and idle period from real traffic. A change to the idle period or the retention numbers must keep ADR-032's public wording true; the retention test already checks the lifetime.

## Consequences

- One caller can no longer fill the service with empty jobs, and an abandoned `create` frees its slot in two minutes.
- A rate-limited visitor gets an accurate message.
- ADR-032 stays true: a job that never received a file is deleted sooner than 10 minutes, never later.
