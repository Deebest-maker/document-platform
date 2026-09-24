# ADR-010: M0 workspace foundation

Date: 2026-09-24

Status: Accepted within the user-approved M0 plan

## Context

The Development Roadmap defines M0 as the monorepo, quality tooling, CI, docs/ADR, design tokens, and a basic app shell. Foundation backlog DEV-001 through DEV-003 requires buildable web/processor folders, quality checks, and a processor health endpoint/container. DEV-005 supplies the basic layout and tokens. Product discovery, ToolShell, the registry, and document tools belong to later milestones.

Related requirements: SRS CON-TECH-001 through CON-TECH-006, CON-COST-002, NFR-A11Y-001/002/005, and the QA/DevOps foundation gates. Source documents 04, 05, 06, 08, 09, 10, and 11 remain authoritative.

## Decision

- Use pnpm workspaces with Node 24 and separate `apps/web` and `packages/ui` packages. Keep Python dependency resolution independent under `services/processor`, using Python 3.13 and uv. Commit both lockfiles and require locked installs in CI.
- Use Next.js App Router, React, strict TypeScript, and Tailwind/PostCSS for the shell. Pin TypeScript 5.9 and ESLint 9 for compatibility with Next.js's lint stack; lock all transitive versions.
- Keep `packages/ui` limited to one shared CSS token file, consumed by the app shell. Use system fonts, neutral colors, spacing, and focus foundations. This does not select the final brand identity or establish a component library.
- Provide one FastAPI endpoint, `GET /health/live`, returning only a typed safe status. Disable API documentation endpoints and access logs for this foundation. The frontend and processor operate independently.
- Build the processor in a multi-stage container with a non-root runtime and version-pinned Python/uv images. Include only runtime Python dependencies; native conversion engines are deferred.
- Use Prettier/ESLint/TypeScript/Vitest/Playwright for web checks and Ruff/mypy/pytest for Python checks. CI verifies the production web build and the restricted processor container on each pull request and push.

## Consequences

Local development needs Node, pnpm, Python, and uv; container verification also needs Docker. No cloud infrastructure is required. The workspace has no task runner beyond pnpm and no shared abstraction package beyond CSS tokens.

The root web page is a temporary development notice with `noindex`, semantic landmarks, a keyboard skip link, and responsive base styling. It is not the M1 homepage. Liveness does not imply conversion readiness. Container limits used by M0 smoke checks are not product processing limits.

Final branding, document engine selection, production limits, retention, hosting, and infrastructure expansion remain governed by the existing decision checkpoints. Before M1, the owner reviews the M0 report and explicitly approves the next milestone.

## References

- [Next.js manual installation](https://nextjs.org/docs/app/getting-started/installation)
- [Tailwind with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [uv locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/)
- [uv Docker integration](https://docs.astral.sh/uv/guides/integration/docker/)
