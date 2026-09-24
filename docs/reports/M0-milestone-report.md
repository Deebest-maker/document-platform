# M0 — Repository/Foundation report

Date: 24 September 2026

Status: Implementation and local verification complete; ready for owner review. Hosted CI execution awaits the initial push.

**Implemented.** Created the pnpm monorepo, a minimal Next.js App Router shell, shared CSS tokens, a separate FastAPI liveness service, a processor container, locked dependency environments, quality checks, GitHub Actions CI, and local setup documentation. Scope follows roadmap M0 and foundation tasks DEV-001/002/003 plus the base-layout portion of DEV-005. `packages/ui` contains only its package manifest and one CSS token file.

**Architecture and technical decisions.** [ADR-010](../adr/010-m0-workspace-foundation.md) records pnpm/Node 24 for web tooling, uv/Python 3.13 for the independent processor environment, strict TypeScript, and a minimal shared-token boundary. The web page renders a development notice with `noindex`, system fonts, semantic landmarks, and a keyboard skip link. The processor exposes only `GET /health/live`. Its runtime image uses reviewed image digests, UID/GID 10001, and runtime dependencies only. GitHub Actions references are pinned to verified commit SHAs with read-only repository permissions. Vitest checks server-rendered HTML; Playwright checks real browser behavior.

**Files and modules added.**

| Location                    | Material additions                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Repository root             | Workspace manifests/lockfile, Node version, Git/editor/format settings, safe environment example, README and scripts |
| `apps/web`                  | Layout, development page, app styles, Next/TypeScript/ESLint/PostCSS configuration, Vitest and Playwright checks     |
| `packages/ui`               | Shared `tokens.css` and package manifest only                                                                        |
| `services/processor`        | Typed health endpoint, tests, `pyproject.toml`, `uv.lock`, Python version, Dockerfile and restricted build context   |
| `.github/workflows/ci.yml`  | Web, processor, and processor-container verification jobs                                                            |
| `docs/adr`                  | ADR index and ADR-010                                                                                                |
| `docs/dependency-review.md` | Dependency version/license review and compatibility notes                                                            |
| `docs/reports`              | This milestone report                                                                                                |

The original 11 Word documents and `AGENTS.md` were preserved. Dependency caches, virtual environments, browser output, and the clean-install verification copy are ignored local artifacts.

**Tests and verification.**

| Check                      | Result                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full `pnpm check`          | Passed: Prettier, ESLint with zero warnings, TypeScript, Vitest, production build, Playwright                                                                                |
| Vitest                     | 1 server-render test passed                                                                                                                                                  |
| Playwright                 | 2 tests passed: desktop Chromium and mobile Chromium                                                                                                                         |
| Browser assertions         | Landmarks, visible heading, `noindex`, keyboard skip link/focus, no horizontal overflow, no page errors, no external requests                                                |
| Visual review              | Desktop and mobile screenshots inspected; restrained layout and text fit confirmed                                                                                           |
| Python checks              | Ruff formatting/lint and strict mypy passed; pytest 2/2 passed without warnings                                                                                              |
| Processor container        | Build passed; health JSON, UID 10001, read-only root, resource limits, absence of pytest, rejection of document jobs, and graceful shutdown verified; test container removed |
| Clean source-copy installs | `pnpm install --frozen-lockfile` and `uv sync --locked` passed with existing lockfiles                                                                                       |
| Dependency audits          | pnpm: no known vulnerabilities; uv: no known vulnerabilities or adverse project statuses                                                                                     |
| License review             | No AGPL identifiers found in the installed dependency inventory; notice obligations recorded in the dependency review                                                        |
| CI definition              | YAML parsed successfully; all action references are pinned                                                                                                                   |

The initial DOM-emulator test startup timed out on this Windows environment. The static M0 page now uses a server-render test, while browser behavior remains covered by Playwright. A PostCSS lint warning and deprecated Python test-client dependency were corrected. An offline clean-install attempt lacked cached metadata; the documented online locked install passed supply-chain policy checks. No tests or quality checks were disabled.

**Known limitations.** Hosted GitHub Actions has not run: the repository remains uncommitted and unpushed. Required-check/branch-protection settings and PR review are still needed before merging material changes. Browser verification is limited to the M0 Chromium desktop/mobile matrix; broader browser and document-processing acceptance belongs to subsequent milestones. ESLint 9 is deprecated but retained for the current Next.js plugin peer requirements; the pinned uv audit command is experimental. See the dependency review for details.

**Deviations from documentation.** No product-scope, processing-architecture, privacy, retention, or licensing deviations. Package-manager and test-environment choices refine the approved foundation plan. The combined first-sprint suggestion in the roadmap was bounded to M0 as instructed; M1 and later functionality was not implemented.

**Security and privacy.** No document processing, upload path, accounts, database, Redis, queue, cloud storage, AI, analytics, advertising, or conversion engine was introduced. The shell makes no third-party requests in the browser smoke tests. Framework telemetry and processor access logs are disabled. Health output contains only safe status data. Tests use the development shell and synthetic request bytes. Temporary test containers are removed; dependency and container notices are retained. Future document handling still requires the full documented privacy and isolation controls.

**Unresolved decisions.** No architecture decision blocks M0 review. Hosted CI and repository protection need validation after the initial publication. Final brand identity, document limits, retention, conversion benchmarks, and production hosting remain at their documented later checkpoints.

**Recommended next milestone.** M1 — Product Shell: homepage, tool registry, All Tools, ToolShell, processing-mode indicators, and trust/legal placeholders. M1 requires explicit owner approval under `AGENTS.md`. Work stops here pending that approval.
