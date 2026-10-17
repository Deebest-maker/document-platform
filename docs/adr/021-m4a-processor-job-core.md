# ADR-021: M4A Processor Job Core

**Status:** Implemented under the approved M4A gate; owner acceptance pending
**Date:** 2026-10-17
**Milestone:** M4A — Processor Job Core
**Scope:** `services/processor/app/*` (new `jobs/`, `api/`, `config.py`, `errors.py`, `logging.py`); matching `tests/`.

## Context

M4A establishes the server-processing foundation on which M4B's LibreOffice adapter and M4C's Word→PDF product slice depend. The slice must land **without LibreOffice and without any public SERVER tool activation**. All route behaviour is proved against a `FakeEngine`; a real engine replaces it in M4B.

Governance §9 picks the smallest architecture that satisfies the security requirements: one processor container, LibreOffice-as-subprocess (M4B), async subprocess execution, concurrency = 1, in-memory job state, memory-resident pending data, exactly one on-disk workspace, a validated jobs root with a sentinel, janitor refusing unsafe roots, separate random job ID + capability token with hash-only server storage, no source-filename-derived paths, fixed `word-to-pdf.pdf` output name. M4A implements every piece of that envelope except the real engine.

## Decision

### 1. Minimal control plane; no new dependency.

FastAPI stays a control plane. New files live under `app/jobs/` (pure logic) and `app/api/` (HTTP). Everything builds on the existing `fastapi`, `pydantic`, `uvicorn` and the dev tools already in `pyproject.toml`. No runtime or development dependency was added. `pyproject.toml` and `uv.lock` are unchanged.

### 2. Job state machine.

`JobState` is a `StrEnum` with eight values. `assert_can_transition` enforces the approved graph: `CREATED → UPLOADING → VALIDATING → PROCESSING → SUCCEEDED`. `FAILED`, `EXPIRED` and `CANCELLED` are reachable from every active state; terminal states are terminal. Skipping or going backwards raises `ProcessorError(CONFLICT)`.

### 3. In-memory store.

`InMemoryJobStore` protects every mutation with a single `asyncio.Lock` so a worker count of one is honoured even under concurrent requests. Each job has a side-table `asyncio.Event` for cancellation, so the async runner can wait on cancellation and process-completion simultaneously. The store refuses `create` when `max_inflight` active jobs already exist (`NOT_READY`), and `cancel` on a terminal job returns `CONFLICT`.

### 4. Capability auth.

`auth.issue()` mints a 128-bit URL-safe `job_id` and a 256-bit URL-safe `token` (both via `secrets.token_urlsafe`). The store keeps only `hash_token(token)` (SHA-256 hex). `tokens_match` uses `hmac.compare_digest`. `store.authorize(job_id, token)` is the single authorization entry point and raises `INVALID_JOB` (404) when the ID is unknown, `INVALID_TOKEN` (401) on any mismatch — the two branches are intentionally distinct because 128-bit random IDs defeat enumeration regardless. Tokens never appear in logs, URLs or responses after the create call.

### 5. Safe workspace management.

`workspace.validate_jobs_root` refuses `/`, `/tmp`, `/var/tmp`, `/root`, `/home`, `/usr`, `/etc`, `/app`, a symlinked root, a non-directory, and any root missing the configured sentinel file. `create_workspace` only accepts URL-safe `job_id` strings (no `/`, `\\`, `\x00`, `.`, `..`) and mkdirs at mode `0o700`. `remove_workspace` resolves the candidate and refuses anything that is a symlink, is not a direct child of the validated root, or escapes the root via `..`. `direct_children` enumerates only non-symlink directories.

### 6. Janitor.

`Janitor.sweep` iterates `direct_children(jobs_root)` and removes a workspace only when its owning job is in a terminal state and older than `job_lifetime_seconds`, or when there is no owning job at all (crash leftover). The sentinel file is never a direct-child directory, so it cannot be removed. The sweep logs failures but never crashes the service; the `_loop` task keeps running on an `asyncio.Event`-gated interval.

### 7. Async runner.

`runner.run_process` wraps `asyncio.create_subprocess_exec` with `start_new_session=True`, giving the child its own process group. `cancel_event` and the process's own exit are awaited together; on cancellation or timeout, `os.killpg` sends `SIGTERM` to the whole group, then `SIGKILL` after a short grace. `argv` is a fixed list — no shell, no interpolation. The runner is wired into the engine protocol for M4B; M4A's `FakeEngine` does not spawn processes but shares the cancellation semantics via the same `asyncio.Event`.

### 8. Engine interface + fake engine.

`ConversionEngine` protocol accepts `workspace`, `input_path`, `output_path` and a `cancel_token`. `FakeEngine` writes a tiny valid-looking PDF (`%PDF-1.4` header plus `%%EOF`) so output validators have something to exercise. Writing outside `workspace` is `INTERNAL`; missing input is `INVALID_INPUT`; cancellation during the configurable delay is `CANCELLED`.

### 9. HTTP surface.

`POST /v1/jobs` creates and returns `(id, token, state)`; the token is seen by the client once. `PUT /v1/jobs/{id}/input` uploads the raw body (bounded by `max_input_bytes`), moves the state to `UPLOADING`, and materialises the on-disk workspace. `POST /v1/jobs/{id}/convert` runs the engine inside the workspace, writes `word-to-pdf.pdf` and moves to `SUCCEEDED`. `GET /v1/jobs/{id}` returns the current state. `GET /v1/jobs/{id}/output` streams the fixed-name output as `application/pdf` with `Cache-Control: no-store`. `DELETE /v1/jobs/{id}` cancels, removes the workspace and clears the store entry; after that the job is `INVALID_JOB`. Every error response carries a `{code, message}` detail drawn from the safe vocabulary — no stack traces, no filenames, no paths.

### 10. Health.

`/health/live` is unchanged. `/health/ready` returns `ok` only when the jobs root validated at startup and the janitor is running; otherwise it returns 503 with the `NOT_READY` code.

### 11. Dev CORS.

When `PROCESSOR_ENV=development` and `PROCESSOR_DEV_CORS_ORIGINS` is non-empty, the app mounts `CORSMiddleware` for the configured origins only. Production/test environments never mount it. The allowlist is comma-separated via the config.

### 12. Structured, allowlisted logging.

`logging.safe_log` emits JSON with a hard-coded `_ALLOWED_FIELDS` set (`event`, `level`, `code`, `job_id`, `tool`, `state`, `input_bytes`, `output_bytes`, `duration_ms`, `engine`, `pid`). Unknown keys are silently dropped. No filename, no token, no body bytes, no stack trace, no raw metadata reaches a log line.

### 13. Fixed output filename.

Every successful job's downloadable artifact is `word-to-pdf.pdf`. The input filename never flows into the response, the stored job, or the on-disk filesystem (the file is always `input.docx` under the workspace).

## Non-goals of M4A

- **No LibreOffice**, no DOCX validator beyond "non-empty + under size cap", no PDF output validator beyond "file exists, header check, size cap", no fonts, no qpdf. Those arrive in M4B behind the engine protocol this slice defines.
- **No activation** of a public SERVER tool. `/word-to-pdf` route in the web app is not touched in M4A.
- **No persistent storage, no database, no Redis, no queue, no object store.** The in-memory store is intentional; restart loses jobs. Scale/availability triggers a later ADR.
- **No `pnpm-lock.yaml`, no `uv.lock`, no `node_modules` changes.** Zero new deps.
- **No LOCAL privacy regression.** The LOCAL E2E suites are untouched; their invariants still hold.

## Consequences

- The processor becomes a real control plane with authenticated job handling, but is still trivially restartable; losing in-memory state is acceptable until horizontal scale is a real requirement.
- Branch protection's three CI jobs (`web`, `processor`, `processor-container`) continue to apply. The container job still runs the Dockerfile exactly as before; the new code is Python-only and ships inside the existing image.
- The engine protocol commits M4B to swap in LibreOffice behind the same signature, with the same cancellation and workspace discipline.
- The retention value for M4C remains governed by §9's "Product Owner-approved after M4B benchmark evidence" rule; M4A sets a 15-minute default lifetime for cleanup planning only.

## Links

- Governance: `docs/12_Claude_Engineering_Handoff_Governance.md` §9, §10, §11.
- Milestone report: `docs/reports/M4A-milestone-report.md`.
- Tests: `services/processor/tests/jobs/*.py`, `services/processor/tests/test_jobs_api.py`, `services/processor/tests/test_health.py`.
