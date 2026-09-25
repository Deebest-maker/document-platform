# Document & File Platform

Privacy-first document utilities, built milestone by milestone. The current implementation is **M1: Product Shell**, built on the verified M0 foundation: tool discovery, a shared registry, planned privacy indicators, a nonfunctional tool preview, and a separate FastAPI liveness service. Document processing is not implemented.

## Source of truth

Read [AGENTS.md](AGENTS.md) and the approved Word documents in [docs](docs/) before changing behavior or scope. The PRD/SRS own requirements; the architecture and security documents define processing boundaries. [ADR-010](docs/adr/010-m0-workspace-foundation.md) records the foundation tooling decisions.

[ADR-011](docs/adr/011-m1-product-shell.md) records M1's reviewed boundaries and neutral server-processing wording. Processing modes describe the current approved MVP plan; future changes require review.

## Product preview

- `/`: task search, featured planned tools, categories, and processing explanations.
- `/tools`: all 13 documented MVP records, with in-memory search and category filtering.
- `/merge-pdf`: the only tool-page preview. It cannot select, upload, merge or download files.
- `/about`, `/privacy`, `/terms`, `/contact`: lightweight trust information; unfinished policy/contact copy is labeled clearly.

All routes remain `noindex`. Other tools link to catalog entries instead of nonexistent tool pages. Search queries are not persisted, placed in URLs, or sent to a service. No third-party scripts, remote fonts, analytics, advertising, or document engines are introduced.

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

## Verify the foundation and product shell

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

`pnpm check` runs formatting, ESLint across web/shared sources, strict TypeScript, Vitest registry/rendering tests, the production web build, and Playwright on desktop and mobile Chromium. The browser suite starts its own production server on port 3100; that port must be free. It checks discovery, registry-derived privacy labels, preview restrictions, keyboard focus/disclosures, noindex, 404s, 320px reflow with enlarged text, reduced motion, axe accessibility scans, JavaScript errors, and unexpected requests. These checks do not claim document-processing correctness or full WCAG conformance.

Browser screenshots are written under `apps/web/test-results/`, and the HTML report is under `apps/web/playwright-report/`; both are ignored by Git. Inspect home/catalog/preview screenshots at desktop and mobile widths after UI changes. Retain manual visual and keyboard review alongside automated accessibility checks.

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
apps/web/                 Routes, shell, interactive discovery, tests
packages/tool-registry/    Typed catalog, modes, privacy copy and pure selectors
packages/ui/              Tokens, ToolShell, PrivacyIndicator and shared CSS
services/processor/       FastAPI health service, Python checks, Dockerfile
docs/adr/                 Approved implementation decisions
.github/workflows/ci.yml  M0 verification on pull requests and pushes
```

CI installs from lockfiles, runs the checks above, builds the processor image, and verifies it under the same restrictions. Browser failure artifacts contain only public preview pages and synthetic search inputs. Use short-lived feature branches and pull requests for material changes; main requires the `web`, `processor`, and `processor-container` checks under the existing branch protection.

M2 introduces the first actual local PDF workflow only after explicit approval. FilePicker, browser PDF engines, workers, and document processing are outside M1. Learn/content, production SEO, final branding, and public deployment remain later work.
