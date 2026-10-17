# M4A Milestone Report — Processor Job Core

**Status:** IMPLEMENTATION COMPLETE — PRODUCT OWNER ACCEPTANCE PENDING
**Branch target:** `feat/m4a-processor-job-core` (not yet created on `origin`)
**Expected `main` baseline:** `c26481e`
**Reporter:** Claude Cowork (standing primary engineer)
**Date:** 2026-10-17

## 1. What changed

- `services/processor/app/errors.py` — `ErrorCode` enum + allowlisted `MESSAGES` and HTTP `STATUS` tables + `ProcessorError`.
- `services/processor/app/config.py` — frozen `Settings` + env loader; no new runtime dep (reads env with `os.environ` and validates with pydantic).
- `services/processor/app/logging.py` — JSON logger with a hard-coded allowlist of fields; `safe_log` drops unknown keys silently.
- `services/processor/app/jobs/state.py` — `JobState` enum, transition rules, `Job` dataclass. No raw token stored.
- `services/processor/app/jobs/auth.py` — ID + token minting (`secrets.token_urlsafe`), SHA-256 token hash, `hmac.compare_digest`, Bearer extraction.
- `services/processor/app/jobs/store.py` — `InMemoryJobStore` with asyncio lock, cancellation events, max-inflight gate, state-transition hook, `authorize()` entry point.
- `services/processor/app/jobs/workspace.py` — jobs-root validation (absolute path, sentinel, forbidden-root list, no-symlink), workspace create/remove with structural-child enforcement, non-symlink `direct_children`.
- `services/processor/app/jobs/janitor.py` — async loop that sweeps terminal + crash-leftover workspaces only, never follows symlinks, never crashes on failure.
- `services/processor/app/jobs/runner.py` — async subprocess runner with process-group isolation (`start_new_session=True`), SIGTERM-then-SIGKILL on cancel/timeout, fixed `argv`.
- `services/processor/app/jobs/engines/base.py` — `ConversionEngine` protocol.
- `services/processor/app/jobs/engines/fake.py` — `FakeEngine` writing a tiny valid PDF; honours cancellation; refuses out-of-workspace writes.
- `services/processor/app/api/health.py` — adds `/health/ready` (503 with `NOT_READY` when jobs root/janitor isn't ready); `/health/live` unchanged.
- `services/processor/app/api/jobs.py` — `POST /v1/jobs`, `PUT /v1/jobs/{id}/input`, `POST /v1/jobs/{id}/convert`, `GET /v1/jobs/{id}`, `GET /v1/jobs/{id}/output`, `DELETE /v1/jobs/{id}`. Fixed output filename `word-to-pdf.pdf`. Safe error vocabulary on every failure path.
- `services/processor/app/main.py` — `create_app()` factory with lifespan janitor start/stop, optional dev-CORS, router wiring. Default `app` for uvicorn preserved.
- `services/processor/tests/conftest.py` — per-test `Settings` and FastAPI `TestClient` fixtures with a tmp-path jobs root.
- `services/processor/tests/test_health.py` — rewritten against the fixtures; keeps the `test_foundation_does_not_accept_document_jobs` sense (now expects 404/405 for `POST /v1/jobs/merge-pdf` because `merge-pdf` is LOCAL and not a known server tool).
- `services/processor/tests/test_jobs_api.py` — HTTP-level integration tests (happy path, auth missing/wrong/cross-job, empty/oversized upload, state-conflict guards, idempotent delete, unknown-tool rejection, double-upload rejection).
- `services/processor/tests/jobs/*.py` — unit tests for errors, state transitions, auth, store, workspace, janitor, runner, fake engine.
- `docs/adr/021-m4a-processor-job-core.md` — new ADR.
- `docs/adr/README.md` — ADR-021 row added.
- `docs/12_Claude_Engineering_Handoff_Governance.md` — §1.2 rewritten as a three-role model (Product Owner, Cowork primary, Code fallback). Version 1.1.
- `docs/reports/M4A-milestone-report.md` — this file.

## 2. Deviations from plan

None of substance. Two small reshuffles:
- The async subprocess runner lives in `app/jobs/runner.py` even though M4A does not spawn processes, because the engine protocol commits to its cancellation shape and tests exercise it directly against the real `python -c …` command. This keeps M4B's slot in the engine interface already proven.
- The convert endpoint collapses the "validating" state into a brief pre-engine transition; M4B will insert the DOCX validator between `UPLOADING→VALIDATING` and `VALIDATING→PROCESSING` without changing route shape.

## 3. Tests and checks (Cowork scratch, isolated .venv built from `uv.lock`)

```
uv run ruff format --check .   → 30 files already formatted
uv run ruff check .            → All checks passed!
uv run mypy                     → Success: no issues found in 30 source files
uv run pytest -q               → 65 passed in 0.84s
```

Breakdown of the 65 passing tests:

- `tests/jobs/test_errors.py`              — 3
- `tests/jobs/test_state.py`               — 7
- `tests/jobs/test_auth.py`                — 7
- `tests/jobs/test_store.py`               — 10
- `tests/jobs/test_workspace.py`           — 11
- `tests/jobs/test_janitor.py`             — 4
- `tests/jobs/test_runner.py`              — 4
- `tests/jobs/test_fake_engine.py`         — 4
- `tests/test_health.py`                   — 3
- `tests/test_jobs_api.py`                 — 12

`uv audit --locked` fails on this cloud container because the proxy blocks `api.osv.dev`; this is NOT an M4A issue — the hosted GitHub Actions `processor` job runs the same audit without the proxy restriction and remains authoritative.

## 4. Benchmarks

None required for M4A. Governance §9.3 and §12 explicitly route numeric limit decisions to M4B/M4D with real evidence; the engineering caps in `config.py` are placeholders used only by the fake engine and tests (20 MiB in, 32 MiB out, 15-minute lifetime, 2-minute runner timeout).

## 5. Security / privacy evidence

- **Capability token:** 256-bit URL-safe (`secrets.token_urlsafe(32)`); server stores only `sha256` hex; `hmac.compare_digest` is used for the comparison. Tokens never appear in logs (allowlist excludes them), URLs (routes use job IDs only), responses after creation, or stored state.
- **Separation of job ID and token:** different random values, different lengths. Cross-job authorization is unit-tested (`test_token_from_one_job_cannot_access_another`).
- **No user filename on disk:** the input is always written as `input.docx` and the output is always `word-to-pdf.pdf`. The HTTP response's `Content-Disposition` carries the fixed name.
- **Jobs root safety:** absolute-path requirement, sentinel marker check, forbidden-root list (`/`, `/tmp`, `/var/tmp`, `/root`, `/home`, `/usr`, `/etc`, `/app`), symlinked-root rejection, structural-child-only enforcement on remove. Covered by `test_workspace.py`.
- **Janitor safety:** `direct_children` filters out symlinks and non-directories; `remove_workspace` refuses symlinks and anything that isn't a direct child; the sentinel file is a file, so it cannot be returned as a child. Covered by `test_janitor.py` (`test_sweep_never_removes_the_sentinel`).
- **Process isolation:** `run_process` uses `start_new_session=True` and `os.killpg`; cancellation is unit-tested on a real 30-second `python -c "time.sleep(30)"` subprocess.
- **Safe error vocabulary:** every HTTP failure path returns `{code, message}` from `MESSAGES` with no interpolation. No stack traces or filesystem paths cross the response boundary.
- **Logging:** JSON output, allowlisted keys only. `safe_log` filters unknown keys silently (defence against caller mistakes).
- **LOCAL privacy unchanged:** no file in `apps/web/*` or `packages/*` was touched. The LOCAL E2E suites' allowlists and canary audits still hold.

## 6. Dependency / license status

- No runtime dependency added. `services/processor/pyproject.toml` and `services/processor/uv.lock` are byte-identical to `main`.
- No dev dependency added. `httpx2`, `mypy`, `pytest`, `ruff` already present.
- `THIRD_PARTY_NOTICES.md` unchanged.

## 7. Diff audit against `main`

- All new files sit under `services/processor/app/` and `services/processor/tests/`.
- `services/processor/app/main.py` was replaced; the previous liveness endpoint behaviour is preserved and now served by `app/api/health.py`.
- `services/processor/tests/test_health.py` was replaced; both existing assertions survive in spirit (`test_liveness_exposes_only_safe_status`, `test_foundation_endpoint_404_still_holds`) and a new `test_readiness_is_ok_when_jobs_root_is_valid` covers the new route.
- `docs/adr/README.md` gained ADR-021 row.
- `docs/12_Claude_Engineering_Handoff_Governance.md` §1.2 rewritten; version 1.0 → 1.1.
- No changes under `apps/web/*`, `packages/*`, `tests/fixtures/*`, `pnpm-lock.yaml` or `services/processor/pyproject.toml` / `uv.lock`.
- No generated artefact staged (`.venv`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `__pycache__` are gitignored).

## 8. Commit / branch / push

Not committed, not pushed. The slice is coherent and buildable (every intermediate file has its tests). The Product Owner creates the branch and runs the push block when ready — see §10.

Suggested commit shape (one commit, since the whole slice is one coherent unit and the branch at this commit must still be buildable):

```
feat(m4a): add processor job core with capability auth, safe workspace and fake engine

Introduces the server-processing foundation for M4. FastAPI gains a /v1/jobs
surface with capability-token auth (random job id + separate 256-bit token,
hash-only server storage, constant-time compare), an in-memory job store
with explicit state machine, a validated jobs root with sentinel + refuse
unsafe roots, a janitor that only touches direct non-symlink children, an
async subprocess runner with process-group termination, and a fake engine
used by M4A tests. /health/ready reports whether the jobs root validated
and the janitor is running. Dev-only CORS allowlist controlled by
PROCESSOR_ENV + PROCESSOR_DEV_CORS_ORIGINS. Fixed output filename
word-to-pdf.pdf; the input filename never reaches disk. No new runtime or
dev dependency, no lockfile change. ADR-021 records the design;
governance 12_Claude_Engineering_Handoff_Governance.md moves to v1.1 with
the three-role split (Product Owner / Cowork primary / Code fallback).
LibreOffice, DOCX validation, qpdf, fonts and route activation remain in
M4B/M4C.
```

Attribution: no `Co-Authored-By:` line (per your saved preference).

## 9. Known limitations / spikes

- The real engine (LibreOffice) is M4B. The fake engine's output is a tiny but valid-looking PDF, enough for the output size + header check.
- Numeric caps (`max_input_bytes`, `max_output_bytes`, `runner_timeout_seconds`, `job_lifetime_seconds`) are placeholders for M4A; M4B/M4D benchmarks determine the launch values.
- The dev-CORS allowlist is unused until the web client exercises it in M4C.
- `uv audit --locked` could not reach `api.osv.dev` from this cloud container; the hosted CI's `processor` job remains the authoritative audit.

## 10. Product Owner manual tests still required

1. Create branch `feat/m4a-processor-job-core` from `main`.
2. Run on Windows (same proxy-free environment as the hosted CI equivalent):

```powershell
cd C:\Users\TOMA\Documents\document-platform\services\processor
uv sync --locked
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run pytest -q
uv audit --locked
```

Expect: all green, 65 tests pass.

3. Smoke-test the service once by hand:

```powershell
# One shell:
uv run --no-dev uvicorn app.main:app --port 8000
```

```powershell
# Second shell:
curl.exe http://127.0.0.1:8000/health/live
curl.exe http://127.0.0.1:8000/health/ready
```

The second response may return 503 if `PROCESSOR_JOBS_ROOT` has not been prepared on disk — that is the intended behaviour. To exercise the full happy path locally, create a jobs root with a sentinel and point the env at it:

```powershell
mkdir -Force C:\temp\jobs
"ok" | Set-Content -Path C:\temp\jobs\.document-platform-jobs-root
$env:PROCESSOR_JOBS_ROOT = "C:\temp\jobs"
uv run --no-dev uvicorn app.main:app --port 8000
```

4. If local checks are green, push the branch and let the hosted CI's three required jobs (`web`, `processor`, `processor-container`) run. The `web` job is a no-op for this slice (no browser code changed); the `processor` job runs the full gate above against the Linux runner; the `processor-container` job rebuilds the image and re-verifies restricted runtime.

Nothing on `/word-to-pdf` is activated; the Product Owner does not need to perform a browser acceptance for M4A. Merge is still gated on CI green; manual browser acceptance returns at M4C when the real tool goes live.
