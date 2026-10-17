# ADR-022: M4B LibreOffice Adapter & Container

**Status:** Implemented under the approved M4B gate; owner acceptance pending
**Date:** 2026-10-17
**Milestone:** M4B — LibreOffice Adapter & Container
**Scope:** `services/processor/app/jobs/engines/libreoffice.py`, `app/jobs/validators/docx.py`, `app/jobs/validators/pdf.py`, `app/jobs/runner.py`, `Dockerfile`; matching `tests/jobs/`.

## Context

M4A delivered the processor job core with a `FakeEngine`. M4B replaces it with a real LibreOffice headless conversion engine and adds defence-in-depth input/output validation so that hostile documents never reach LibreOffice and broken PDFs never reach the client. Governance §10 mandates subprocess isolation, environment scrubbing, fresh user profiles, counting-inflate zip bomb defence, OOXML structure validation, macro/encryption rejection, DTD rejection, path-traversal prevention, and fail-closed PDF output validation.

## Decision

### 1. LibreOffice Engine (`libreoffice.py`)

`LibreOfficeEngine` implements the `ConversionEngine` protocol from M4A. It invokes `soffice --headless --convert-to pdf` via the shared `run_process` async runner. Key isolation measures:

- **Fixed argv** — no shell, no interpolation.
- **Fresh UserInstallation** — a `_lo_profile/` directory inside the job workspace, scrubbed after conversion.
- **Scrubbed environment** — only `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL` are forwarded; `HOME` and `TMPDIR` are set to the workspace.
- **Process group isolation** — the child runs in its own session (`start_new_session=True`); cancellation sends `SIGTERM` to the group, then `SIGKILL` after a 5-second grace via the M4A runner.
- **Output renaming** — LibreOffice names output after the input stem; the engine renames to the fixed `word-to-pdf.pdf`.

### 2. Conditional engine selection (`main.py`)

Production instantiates `LibreOfficeEngine`. When `PROCESSOR_ENV=test` or `soffice` is not on `PATH`, the app falls back to `FakeEngine`. This keeps the M4A test suite running unmodified on any developer machine without LibreOffice.

### 3. DOCX preflight validator (`validators/docx.py`)

`validate_docx(data: bytes)` is synchronous, pure-stdlib, and runs before any file touches LibreOffice. It applies a layered rejection pipeline:

1. **Empty / legacy .doc** — zero-byte or OLE compound-document magic (`\xd0\xcf\x11\xe0…`) rejected.
2. **ZIP structure** — `zipfile.is_zipfile` + `ZipFile` construction catches truncated or non-ZIP inputs.
3. **Entry safety** — entry count cap (10,000), duplicate detection, NUL byte, backslash, absolute path, `..` traversal.
4. **Counting-inflate** — reads every entry in bounded 64 KiB chunks, tracking per-entry (100 MiB) and total (200 MiB) expanded bytes. Never trusts declared sizes alone.
5. **Compression ratio** — entries with declared-ratio > 100:1 are rejected before decompression.
6. **Required OOXML parts** — `[Content_Types].xml` and `word/document.xml` must be present.
7. **Macro detection** — `vbaProject.bin` and `vbaData.xml` entries are rejected.
8. **Encryption detection** — ZIP entry encryption flag (bit 0 in both local and central directory headers) and `EncryptedPackage` content type in `[Content_Types].xml`.
9. **DTD rejection** — `<!DOCTYPE` and `<!ENTITY` in structural XML parts (`[Content_Types].xml`, `_rels/.rels`, `word/_rels/document.xml.rels`).

### 4. PDF output validator (`validators/pdf.py`)

Three functions run after conversion, fail-closed:

- `validate_pdf_header` — synchronous; checks the first 5 bytes match `%PDF-`. Missing, empty, directory, or wrong-magic files raise `INTERNAL`.
- `validate_pdf_qpdf` — async; runs `qpdf --check` if qpdf is installed; any non-zero exit (warnings or errors) rejects the output. Gracefully skips if qpdf is absent (dev machines).
- `validate_pdf_page_count` — async; runs `qpdf --show-npages` and returns the count (0 if qpdf absent). Currently informational; a sanity bound can be added when benchmarks establish expected ranges.

### 5. FakeEngine update

`FakeEngine` now writes a structurally valid single-page PDF with correct xref offsets so that the full output validation pipeline (header, qpdf --check, page count) passes in the API integration tests.

### 6. Container (`Dockerfile`)

The existing multi-stage Dockerfile gains:
- `libreoffice-writer` installed with `--no-install-recommends` (Debian slim).
- `qpdf` for PDF structural validation.
- `fonts-liberation` (Liberation Sans/Serif/Mono, OFL-1.1) for deterministic metric-compatible rendering.
- Non-root user `10001:10001` for the service process.
- `PROCESSOR_JOBS_ROOT` defaults to `/data/jobs` with a sentinel file.

### 7. API wiring (`api/jobs.py`)

The convert endpoint's pipeline is now: DOCX preflight → engine.convert → PDF header → qpdf structural check → page count → size cap → SUCCEEDED. Any failure at any stage marks the job FAILED and returns the appropriate error code. The DOCX preflight runs in a thread pool via `asyncio.to_thread` to avoid blocking the event loop.

### 8. Test suite

Three new test files (37 test cases total):

- `tests/jobs/test_docx_validator.py` — 19 tests across 8 classes covering happy path, basic rejections, missing parts, macros, encryption (ZIP flag + content type), path safety (traversal, absolute, backslash, NUL), compression controls, DTD rejection.
- `tests/jobs/test_pdf_validator.py` — 11 tests covering header validation, qpdf check (with monkeypatch skip), and page count.
- `tests/jobs/test_libreoffice_engine.py` — 8 tests covering construction, input validation, and (when soffice is present) round-trip conversion, cancellation, and environment scrubbing.

The existing `test_jobs_api.py` was updated to upload a real minimal DOCX that passes the preflight validator.

### 9. Dependencies

- `pytest-asyncio>=0.25,<1` added to the dev dependency group with `asyncio_mode = "auto"` in pytest config.
- No new runtime dependencies. The validator and engine use only the Python standard library. `qpdf` and LibreOffice are system packages in the container.

## Non-goals of M4B

- **No real benchmark results yet.** The benchmark harness doc (`docs/benchmarks/M4B-libreoffice.md`) defines the methodology; actual numbers come from a dedicated run against the built container.
- **No retention-time decision.** Governance §9 says retention is "Product Owner-approved after M4B benchmark evidence." M4A's 15-minute default stands until benchmarks land.
- **No horizontal scaling, no persistent queue, no external state.** In-memory store from M4A is unchanged.
- **No PUBLIC tool activation.** The Word→PDF route in the web app is not enabled until M4C.
- **No LOCAL privacy regression.** LOCAL E2E suites are untouched.

## Consequences

- The processor can now convert real DOCX files to PDF via LibreOffice headless, with defence-in-depth validation on both sides.
- Hostile inputs (macros, encryption, zip bombs, DTDs, traversal paths, legacy .doc) are rejected before LibreOffice sees them.
- Broken PDF output is rejected before the client can download it.
- The engine protocol from M4A proved its value: LibreOffice slots in behind the same signature with zero changes to the job state machine, auth, workspace management, or HTTP surface.
- M4C can now build the product slice (web UI activation, retention policy) on top of a proven conversion pipeline.

## Links

- Governance: `docs/12_Claude_Engineering_Handoff_Governance.md` §9, §10, §11.
- M4A foundation: `docs/adr/021-m4a-processor-job-core.md`.
- Benchmark harness: `docs/benchmarks/M4B-libreoffice.md`.
- Tests: `services/processor/tests/jobs/test_docx_validator.py`, `tests/jobs/test_pdf_validator.py`, `tests/jobs/test_libreoffice_engine.py`.
