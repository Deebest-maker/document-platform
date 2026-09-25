# Document & File Platform

Privacy-first document utilities, built milestone by milestone. The current implementation is **M2A: Merge PDF Vertical Slice**, built on the approved M0/M1 foundation. Merge PDFs locally in the browser, arrange file order, download, and start over. The other 12 tools remain planned. M2B and the rest of M2 are not implemented.

## Source of truth

Read [AGENTS.md](AGENTS.md) and the approved Word documents in [docs](docs/) before changing behavior or scope. The PRD/SRS own requirements; the architecture and security documents define processing boundaries. [ADR-010](docs/adr/010-m0-workspace-foundation.md) records the foundation tooling decisions.

[ADR-011](docs/adr/011-m1-product-shell.md) records M1's reviewed boundaries and neutral server-processing wording. Processing modes describe the current approved MVP plan; future changes require review.

[ADR-012](docs/adr/012-m2a-local-merge.md) records the approved Merge boundaries, benchmark-triggered worker, lifecycle and engineering limits. See the [M2A benchmark evidence](docs/benchmarks/M2A.md) and [synthetic fixture manifest](tests/fixtures/pdf/manifest.json).

## Product preview

- `/`: task search, featured tools, availability, categories, and processing explanations.
- `/tools`: all 13 documented MVP records, with in-memory search and category filtering.
- `/merge-pdf`: choose two or more PDFs, add/remove/move files, merge in a dedicated browser worker, download `merged.pdf`, change the selection or start over. Nothing is uploaded; the processor is not required.
- `/about`, `/privacy`, `/terms`, `/contact`: lightweight trust information; unfinished policy/contact copy is labeled clearly.

All routes remain `noindex`. Other tools link to catalog entries instead of nonexistent tool pages. Search queries and document state are not persisted, placed in URLs, or sent to a service. No third-party scripts, remote fonts, analytics or advertising are introduced. `pdf-lib` is isolated in `packages/pdf-browser`; it loads only when Merge is invoked.

Current conservative M2A engineering limits: **20 files, 10 MiB per file, 32 MiB combined, 200 pages, 32 MiB output**. Password-protected/encrypted PDFs are unsupported. Interactive forms, bookmarks and other document-level features may not survive copying; digital signatures do not remain valid. Keep originals. These are not final public launch limits or performance guarantees. Cancel terminates the worker. Reset/navigation revokes downloads and releases session references, without claiming secure memory erasure.

## Prerequisites

- Node.js **24.16.0** (also recorded in `.node-version`).
- pnpm **11.23.0**: `npm install --global pnpm@11.23.0`.
- Python **3.13.15** and uv **0.12.18**: `python -m pip install uv==0.12.18`.
- Docker with a running Linux container engine, for the processor container check.

No secrets or cloud services are required. `.env.example` documents the only optional environment setting; application scripts already disable Next.js telemetry. System fonts avoid remote font requests. Commands below run from the repository root on Windows PowerShell, macOS, or Linux unless stated otherwise.

## Install from a clean checkout

```sh
pnpm install --frozen-lockfile
uv sync --locked --project services/processor
pnpm --filter @document-platform/web exec playwright install chromium
```

On Linux, install browser OS prerequisites with `playwright install --with-deps chromium` instead. Installs must preserve the checked-in lockfiles; deliberate dependency changes must regenerate and review them.

## Run locally

```sh
pnpm dev
```

The development shell is at `http://127.0.0.1:3000`. In a separate terminal:

```sh
uv run --locked --project services/processor uvicorn app.main:app --app-dir services/processor --host 127.0.0.1 --port 8000 --no-access-log --no-server-header
```

`GET http://127.0.0.1:8000/health/live` returns `{"status":"ok"}`. It reports process liveness only. The web shell does not call this service. Stop either development process with Ctrl+C.

## Verify the foundation, product shell and Merge

```sh
pnpm check
uv run --locked --project services/processor ruff format --check services/processor
uv run --locked --project services/processor ruff check services/processor
```

Run the remaining Python checks from `services/processor` so mypy and pytest use the project's configuration:

```sh
uv run --locked mypy
uv run --locked pytest
```

`pnpm check` runs formatting, ESLint across web/shared sources, strict TypeScript, PDF engine/worker/session and registry/rendering tests, the production build, and Playwright on desktop and mobile Chromium. The browser suite starts its own production server on port 3100; that port must be free. It retains M0/M1 discovery, availability, keyboard, noindex, 404, reflow, reduced-motion and axe checks, and adds exact Merge page order/geometry, downloaded-output validation, form/signature support, safe failures, cancellation/recovery, URL lifecycle, offline operation and context-wide privacy checks. Axe is not a full WCAG conformance assessment.

Browser screenshots and synthetic downloads are written under `apps/web/test-results/`, and the HTML report is under `apps/web/playwright-report/`; both are ignored by Git. Inspect desktop/mobile selected/result screenshots and representative PDFs in an independent viewer after engine/UI changes. Only the committed synthetic fixtures may be used in tests or CI artifacts; never run these artifact-producing checks with real user documents.

For formatting changes, run `pnpm format` and `uv run --locked --project services/processor ruff format services/processor` before checking again.

## Verify the processor container

From the repository root:

```sh
docker build --tag document-platform-processor:m0 services/processor
docker run --detach --name document-platform-processor-m0 --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 1 --pids-limit 64 --publish 127.0.0.1:8000:8000 document-platform-processor:m0
```

After the container reports healthy, confirm `GET /health/live`, then stop and remove this test container:

```sh
docker inspect --format '{{.State.Health.Status}}' document-platform-processor-m0
docker stop document-platform-processor-m0
docker rm document-platform-processor-m0
```

The image runs as UID/GID 10001 and contains no conversion engines or development dependencies. The smoke limits above are for the health service, not future conversion limits.

## Layout and CI

```text
apps/web/                 Routes, discovery, route-local Merge workflow and tests
packages/tool-registry/    Catalog, modes, availability, privacy copy and limits
packages/ui/              Tokens, ToolShell, PrivacyIndicator, generic FilePicker
packages/pdf-browser/     Isolated pdf-lib adapter, validation and local worker
tests/fixtures/           Synthetic PDFs, manifest and optional authoring scripts
services/processor/       FastAPI health service, Python checks, Dockerfile
docs/adr/                 Approved implementation decisions
.github/workflows/ci.yml  M0 verification on pull requests and pushes
```

CI installs from lockfiles, runs the checks above, builds the processor image, and verifies it under the same restrictions. Browser failure artifacts contain only public pages and synthetic test data. Use short-lived feature branches and pull requests for material changes; main requires the unchanged `web`, `processor`, and `processor-container` checks under existing branch protection.

M2A does not include PDF.js, thumbnails, page-level selection/reordering, Split, Organize or other tools. M2B needs its own reviewed plan and explicit approval. Learn/content, production SEO, final branding, final legal policies and public deployment remain later work.
