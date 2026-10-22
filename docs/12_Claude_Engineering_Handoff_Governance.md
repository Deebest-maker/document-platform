# 12 — Claude Engineering Handoff & Development Governance

**Project:** Document & File Utility Platform  
**Purpose:** Permanent continuity brief for Claude Cowork and Claude Code  
**Version:** 1.1  
**Date:** 17 October 2026  
**Current accepted repository state:** `main = c26481e`, clean and synchronized with `origin/main`  
**Current milestone:** M4 — Server Processing Core (planning/architecture stage)

> This document is the standing operating contract for Claude. It is intended to let Claude continue architecture, implementation, verification, documentation, and milestone closeout without depending on prior ChatGPT context. The Product Owner retains final product authority.

## 1. Purpose, Authority and Operating Model

This file exists so Claude can take over the project as the standing senior software architect, engineering reviewer and implementation engineer while preserving the original product direction. It must be usable in a fresh Claude Cowork or Claude Code session without relying on chat history.

### 1.1 Product Owner

- The Product Owner owns product intent, final scope, public promises, branding, UX acceptance, launch decisions and spending decisions.

- The Product Owner performs important manual browser acceptance before milestone merge/closure.

- The Product Owner should not be asked to execute routine debugging commands when Claude Code has direct terminal access.

- The Product Owner prefers concise progress reports and a single clear next action, not long back-and-forth for every minor failure.

### 1.2 Role model

The project has three operating roles. Claude Cowork is the primary engineer; Claude Code is a fallback terminal specialist, not the default implementation engineer.

**Product Owner — Toma**

- Owns product direction, final product decisions, public promises, branding, UX acceptance, launch decisions and spending.

- Performs the important manual browser acceptance before milestone merge/closure.

- Should not be burdened with routine engineering coordination between Cowork and Claude Code: Cowork decides the engineering outcome itself and only hands a single complete prompt to the Product Owner when Claude Code is genuinely required.

**Claude Cowork — standing engineer**

- Standing senior software architect, primary implementation engineer, engineering reviewer, security/privacy reviewer, milestone planner, and architecture decision maker within approved product scope.

- Performs repository implementation, testing, debugging and benchmarking directly whenever the Cowork environment allows it (device bridge to the Windows repo, cloud container for Python/Node work that does not need Windows-pinned toolchains).

- Maintains project continuity across sessions by re-reading this handoff, AGENTS.md and the current milestone evidence at the start of every working session.

- Self-reviews architecture, security, privacy, licensing, test coverage and spec alignment before declaring work ready. Continues through routine failures using INSPECT → FIX → TEST → REPEAT rather than stopping after each compiler/test error.

- Never merges a milestone PR or starts the next milestone before the Product Owner has completed the required acceptance gate.

**Claude Code — fallback implementation/terminal specialist**

- Used only when Cowork cannot perform a task itself (destructive terminal work, long-lived builds, workflows that need a dedicated terminal, or environment access Cowork does not have), or when a dedicated terminal workflow is materially better than driving work through the Cowork device bridge.

- Receives one complete self-contained prompt prepared by Cowork, prefixed `SEND TO CLAUDE CODE`. Does not negotiate architecture independently with the Product Owner — architectural decisions are owned by Cowork.

- Reports results back to the Product Owner, who relays them to Cowork. Cowork reviews the output and continues ownership of the project.

- Follows the same binding governance context (this handoff plus AGENTS.md) and the same escalation rules.

### 1.3 Escalation threshold

Claude should decide normal engineering details autonomously. Escalate to the Product Owner only when a decision materially changes product scope, public privacy/retention wording, recurring infrastructure cost, licensing obligations, irreversible architecture, launch behavior, or meaningful residual security risk.

## 2. Source of Truth and Conflict Resolution

At the beginning of every new working session, Claude must read this handoff, root AGENTS.md, git status/branch/HEAD, the current milestone report/ADR, and the relevant authoritative documents. Source code wins over stale milestone prose for current implementation state; approved requirements and security rules win over implementation convenience.

| Priority | Source | Use |
| -------- | ------ | --- |

|1|Root AGENTS.md|Repository-specific coding/agent rules.|

|2|03 SRS + 04 Architecture + 05 Security/Privacy|Functional, technical, security and privacy invariants.|

|3|10 Development Roadmap + 08 QA + 09 DevOps|Milestone scope, verification, CI/deployment requirements.|

|4|02 PRD + 01 Master Product Plan + 06 UX|Product behavior, user experience, MVP boundaries.|

|5|Approved ADRs|Binding decisions unless replaced by a later ADR.|

|6|Current source + tests + CI|Observed implementation truth.|

|7|Milestone reports / benchmark reports|Evidence and historical context; correct drift when found.|

If documents conflict, Claude must identify the conflict, choose the narrowest interpretation that preserves security/privacy and approved roadmap scope, record the reconciliation in an ADR or milestone report, and avoid silently expanding scope.

## 3. Product and Architecture Invariants

- Privacy-first, anonymous MVP. No mandatory accounts, document history or long-term user storage.

- Local-first hybrid processing: use LOCAL when safe/practical; use SERVER only for operations that genuinely require native/server tooling; HYBRID only when evidence justifies it.

- The tool registry is the single source of truth for route, category, accepted types, processing mode, privacy label, related tools and engineering limits.

- LOCAL means document bytes never reach the processing backend. Do not weaken existing LOCAL network/privacy tests to make new server work easier.

- SERVER means the UI discloses upload before it occurs, the server validates independently, uses isolated temporary processing, validates output, authorizes download, and removes artifacts promptly.

- No raw document content, extracted text, page images, sensitive filenames, passwords, secrets or raw metadata dumps in logs/analytics.

- Avoid premature infrastructure. No Redis, PostgreSQL, queues, object storage, Kubernetes or account system unless a measured requirement triggers them.

- No AI features during MVP. OCR remains deferred. No public API/SDK/CLI during MVP.

- PyMuPDF and Ghostscript AGPL variants remain excluded without an explicit commercial/legal decision.

- User-facing copy must never overstate security, redaction, fidelity, retention or processing guarantees.

## 4. Current Technical Architecture

### 4.1 Monorepo boundaries

```text
apps/web/                 Next.js application and route-owned UI sessions
services/processor/         FastAPI control plane for SERVER tools
packages/ui/               Shared accessible UI primitives
packages/tool-registry/    Tool metadata, mode, limits and discovery
packages/pdf-browser/      Browser-only PDF engine boundary
tests/fixtures/            Deterministic fixture corpus
docs/adr/                  Architecture decisions
docs/benchmarks/           Measured engineering evidence
docs/reports/              Milestone reports
```

### 4.2 Browser engine boundary

packages/pdf-browser is the sole browser PDF engine boundary. Do not place server job logic inside it. Existing approved browser dependencies include pdf-lib, pdfjs-dist and fflate. Preserve lazy loading and existing worker/lifecycle patterns.

### 4.3 Processor boundary

FastAPI is a control plane, not a document engine. Native engines sit behind a small adapter boundary: validate → prepare isolated workspace → execute under limits → validate output → publish/stream → cleanup.

### 4.4 UI pattern

ToolShell owns presentation states, not processing logic. Route-owned sessions manage generation guards, cancellation, result lifecycle and Blob/Object URL cleanup. FilePicker does not upload automatically. PrivacyIndicator is registry-driven.

## 5. Accepted Milestone History

| Milestone | Status | Accepted outcome |
| --------- | ------ | ---------------- |

|M0 — Repository/Foundation|COMPLETE|pnpm monorepo, Next.js shell, FastAPI liveness, processor container, lockfiles, CI, ADR-010.|

|M1 — Product Shell|COMPLETE|Registry/catalog, ToolShell/PrivacyIndicator, homepage/tools/trust surfaces, accessibility/privacy foundations.|

|M2 — Local PDF Core|COMPLETE|Real local Merge, PDF.js page/thumbnail foundation, structural operations, worker/lifecycle patterns.|

|M3 — Local Tool Family|COMPLETE|Split, Organize, Extract, Delete, Rotate, Images→PDF, PDF→JPG, PDF→Text, Remove Metadata.|

|M4 — Server Processing Core|COMPLETE|FastAPI job contract, server lifecycle/security core, LibreOffice adapter, Word→PDF product slice, benchmark-derived limits, enforced retention and single-conversion gate (ADR-021 to ADR-024).|

|M5 — Hard Tools / Spikes|COMPLETE|M5A Compress PDF implemented on device with benchmark-derived limits (ADR-025, ADR-026), accepted and merged. M5B PDF→Word fidelity benchmark complete: DEFER to V1.1 (ADR-027), accepted and merged.|

|M6 — Content/SEO|IN PROGRESS|M6A technical SEO foundation (ADR-028), accepted and merged. M6B tool-page guides for the 12 available tools (ADR-029), accepted and merged (`b760cb3`). M6B.1 follow-up (ADR-030: photo metadata removed from JPEGs in Images to PDF; availability and server-processing copy derived from the registry), accepted and merged (`3a51a25`). M6C Learn hub (ADR-031: eight original guides at `/learn`), accepted and merged (`a5a26c9`). Abandoned-job retention decided at 10 minutes (ADR-032). M6D structured data not started; it needs the production domain, brand name and author or publisher line.|

|M7 — QA/Hardening|IN PROGRESS|Planned in seven slices, each accepted separately: M7A CI truth (per-browser jobs, readable failures, red main fixed; test faults and one real cancel bug found), M7B processor abuse controls (ADR-033), M7C web security headers and CSP, M7D bad-input matrix, M7E accessibility, M7F performance budgets, M7G device-test checklist and M7 report. M7A accepted and merged (`2110313`); M7B accepted and merged (`39d954d`). CI reliability follow-ups: pinned runner image, bounded browser install, two flaky tests steadied.|

|M8 — Staging/Launch|FUTURE|Production deployment, monitoring, legal/retention finalization and launch gate.|

|M9 — Monetization Readiness|FUTURE|AdSense only after product/content/policy readiness.|

Current accepted repository state after M3: main = c26481e, origin/main synchronized, working tree clean.

## 6. Standing Development Workflow

1. Inspect the repository and authoritative docs before changing code.

2. Write or update the milestone/slice implementation plan and identify open decisions.

3. Resolve architecture decisions using the smallest design that satisfies the documents; record binding decisions in ADRs.

4. Create one feature branch per reviewable slice. Never work directly on main.

5. Implement vertically: behavior + validation + tests + docs/evidence in the same slice.

6. Run the narrowest relevant tests first, then the full project gate. Fix the first real failure and continue until green.

7. Run benchmarks when limits/fidelity/resource claims depend on measurement. Never invent numbers or commit placeholder benchmark results as evidence.

8. Audit the full diff for architecture drift, accidental files, lockfile/dependency changes, privacy regressions and future-milestone work.

9. Commit coherent, buildable changes. Push feature branch. Let hosted CI be the authoritative gate when local environment limitations exist.

10. Product Owner performs the manual acceptance journey. Only after CI + manual acceptance may the PR be merged.

11. After merge, update main, verify clean state, close the milestone/slice report, and only then start the next approved slice.

### 6.1 Routine errors

When Claude Code has terminal access, do not ask the Product Owner to relay every lint/type/test failure. Diagnose and fix routine issues autonomously. Stop only for a true blocker, ambiguous product decision, missing credential/service, licensing concern, security trade-off, or destructive action requiring approval.

## 7. Definition of Done and Verification Gates

- Requirement/user story is satisfied and traced to the SRS where practical.

- Appropriate unit, integration, E2E and security/privacy tests exist and pass.

- Output is semantically validated, not merely produced.

- Processing location in UI matches actual network behavior.

- Errors are safe and actionable; internal paths/stack traces/engine errors are not exposed.

- Keyboard/mobile/accessibility paths remain usable; WCAG 2.2 AA is the target for core journeys.

- Limits are enforced and benchmark-derived when the docs require measurement.

- Dependency/license review and notices are updated when relevant.

- ADR, benchmark evidence and milestone report accurately match the implementation.

- Required GitHub CI is green and Product Owner manual acceptance passes before merge.

### 7.1 Required existing CI job names

- web

- processor

- processor-container

Do not rename or weaken these required branch-protection jobs. Evolve their checks as the milestone requires.

## 8. Security and Privacy Rules Claude Must Enforce

### 8.1 LOCAL tools

- No document upload to the processor, no unexpected POST/PUT/PATCH/DELETE, no processor/API mutation request, no cross-origin processing request and no WebSocket.

- Document-derived canaries must not appear in URLs, headers, bodies, console or persistent browser storage.

- Do not broaden LOCAL allowlists simply to accommodate SERVER tooling.

### 8.2 SERVER tools

- Browser disclosure before upload.

- Independent server validation; extension and MIME are hints only.

- Random internal identifiers; never trust user filenames as paths/object keys.

- Job authorization required even without user accounts.

- Fresh isolated job workspace and strict lifecycle cleanup.

- No shell interpolation. Fixed executable + argument arrays only.

- Bound CPU/memory/time/process/file/output growth; kill the full engine process tree on timeout/cancel.

- Short-lived authorized download; no public bucket/listing.

- Independent stale-artifact cleanup in addition to normal success/failure cleanup.

- Structured allowlisted logs only; no sensitive content or raw filenames.

## 9. Current M4 Architecture Baseline

M4 is the first SERVER milestone. The current planning work has been reviewed and the following baseline should be treated as the starting decision set unless implementation evidence disproves it.

### 9.1 M4 scope

- FastAPI job contract and state machine.

- Capability authorization without accounts.

- Secure upload path and independent DOCX validation.

- Random job-scoped lifecycle and cleanup/janitor.

- Resource-limited conversion-engine adapter.

- Meaningful /health/ready alongside existing /health/live.

- LibreOffice headless Word→PDF as the first real SERVER tool.

- Benchmarks for LibreOffice fidelity/resource behavior and processor cold start.

### 9.2 Explicit M4 exclusions

- PDF→Word implementation (M5 spike/GO-DEFER).

- Compress PDF implementation (M5).

- OCR, AI, accounts, database, Redis, queue, cloud object storage, public API, analytics rollout, ads and production deployment.

- PyMuPDF, Ghostscript AGPL and other unapproved AGPL engines.

### 9.3 Accepted architecture direction

| Decision | Baseline | Status / guardrail |
| -------- | -------- | ------------------ |

|Job API|Staged create → upload/input → state → authorized download → delete|Accepted shape; exact OpenAPI may evolve only with ADR rationale.|

|Execution model|Bounded synchronous conversion with async-compatible job contract|Accepted for MVP unless benchmarks show hosting/request limits make it impractical.|

|Job state|In-memory, single processor instance/worker|Accepted MVP constraint. Restart loses jobs. Shared state is triggered by scale/availability needs.|

|Authorization|Random job ID + separate high-entropy capability token; server stores token hash only|Accepted. No cookies/accounts. Cross-job mismatch must fail.|

|Upload|Raw request body; no source filename sent to server|Preferred minimal design if implementation verifies it cleanly.|

|Engine topology|LibreOffice as constrained subprocess inside processor container|Accepted baseline because it is smaller than a second container; must pass hostile/isolation probes.|

|Concurrency|Exactly one on-disk conversion at a time for M4 baseline|Security/data-separation invariant until a later architecture change.|

|Output validation|Cheap PDF checks + qpdf --check / page count|Accepted candidate; qpdf warning policy is benchmark/corpus driven.|

|Download filename|word-to-pdf.pdf|Accepted fixed safe filename.|

|Storage|Ephemeral only; pending input/output may remain in memory; one active disk workspace|No S3/R2 unless evidence requires it.|

|Retention|Short, configured and independently cleaned|Public maximum remains a measured/owner-approved decision before route activation; architecture target stays ≤60 min with normal cleanup much earlier.|

|Dev/prod origin|Dev explicit CORS allowlist; production same-origin reverse proxy expectation|Accepted direction; do not create upload proxy rewrites without body-size verification.|

### 9.4 Job states

```text
CREATED → UPLOADING → VALIDATING → PROCESSING → SUCCEEDED
Any non-terminal state → FAILED
Created/succeeded/failed artifacts may transition to EXPIRED by cleanup/lifecycle.
```

### 9.5 Server tool flow

```text
Open /word-to-pdf
→ visible SERVER-processing disclosure BEFORE upload
→ choose DOCX (selection alone does not upload)
→ explicit Upload and convert
→ upload progress
→ validating
→ processing
→ completed
→ authorized download as word-to-pdf.pdf
→ cleanup/delete/reset
```

## 10. M4 Security/Validation Requirements

### 10.1 DOCX preflight

- Reject zero-byte, malformed/truncated ZIP, macro-enabled content, encrypted ZIP entries and legacy .doc.

- Validate ZIP structure and required OOXML package parts; treat MIME/extension only as hints.

- Enforce safe path names, no traversal/absolute/NUL/backslash abuse, no duplicate entries, bounded entry count, bounded declared and actual expanded bytes, and compression-ratio controls.

- Use a bounded counting-inflate pass; do not claim zipfile itself provides bomb protection.

- Reject DTDs in the small XML parts the validator actually parses. Do not overclaim XML/LibreOffice parser safety.

- Do not execute macros. External relationship behavior must be tested; no-network sandboxing is the baseline control unless M4B decides to reject specific relationship classes.

### 10.2 LibreOffice process

- Run non-root in the existing processor container under a fixed command array; no shell=True.

- Use a fresh isolated LibreOffice profile/workspace per job.

- Use asyncio subprocess execution so the FastAPI event loop remains responsive.

- Run the child in its own process group/session and kill the entire tree on timeout/cancel.

- Scrub environment and apply no_new_privs, restrictive umask and benchmark-backed rlimits where proven safe.

- M4 requires no outbound network. Prove the conversion stack works in the no-network test posture.

- Because baseline is same-container/same-UID, preserve the concurrency=1 + single active on-disk workspace invariant and prove the child cannot read unrelated job data/process memory under the chosen hardening.

### 10.3 Janitor/root safety

- Jobs root must be an absolute dedicated safe path with a sentinel/marker and ownership validation.

- Never recursively wipe an arbitrary configured root. Refuse unsafe roots such as /, /tmp, home, app directory, symlinked roots or roots containing foreign entries.

- Janitor deletes only recognized direct child workspaces and must not follow symlinks.

- Cleanup tests cover success, failure, timeout, cancellation, crash-leftover and startup cleanup.

## 11. M4 Slice Plan and Review Gates

| Slice | Scope | Gate |
| ----- | ----- | ---- |

|M4A — Processor Job Core|State model/store, capability auth, safe workspace root, upload path, cleanup/janitor, async runner, cancellation, safe errors/logs, dev CORS, health/ready, fake adapter tests.|Architecture + ADR-021 review; no LibreOffice yet.|

|M4B — LibreOffice Adapter & Container|LibreOffice/qpdf/fonts, DOCX/PDF validators, sandbox profile, fixture corpus, hostile probes, benchmark harness, license notices, CI container hardening.|ADR-022 + real benchmark/security evidence.|

|M4C — Word→PDF Product Slice|Registry activation, neutral SERVER disclosure, route, job client/session/workspace, progress/cancel/download, privacy copy and server E2E.|Retention/public copy resolved; Product Owner flow review.|

|M4D — Verification & Closeout|Full M0–M4 regression, fidelity/cold-start benchmarks, cleanup/auth/container evidence, final limit proposal, ADR-024, milestone report/manual acceptance script.|CI green + Product Owner manual acceptance before merge/close.|

Do not implement the whole milestone as one mega-commit. Each slice should have its own branch/PR or clearly reviewable gate as the repository workflow permits.

## 12. M4 Open Decisions Claude Owns

Claude is authorized to resolve these through spikes, benchmarks and ADRs without returning to an external architect. Product Owner approval is needed only where noted.

| Decision | How to resolve | Owner gate |
| -------- | -------------- | ---------- |

|LibreOffice package/version|M4B distro/image spike + reproducibility/security review.|No, unless licensing/cost changes.|

|qpdf warnings|Representative corpus: fail closed initially, relax only for proven harmless warnings.|No.|

|Fonts|Benchmark fidelity with metric-compatible common fonts; verify actual package licenses.|No, unless licensing restriction appears.|

|Startup warm-up conversion|Measure cold-start/readiness benefit and cost.|No.|

|External relationship policy|Fixture tests for linked resources/templates/hyperlinks under no-network/profile controls. Reject risky classes if needed.|No unless user-visible compatibility is materially reduced.|

|Landlock/stronger isolation|Optional only if practical/host-compatible or hostile probes show baseline insufficient.|Escalate if it changes deployment topology.|

|Retention value|Use M4B/M4D evidence; one public/config value, no more than 60 minutes, normal cleanup earlier.|YES before M4C route becomes available/public copy changes.|

|Numeric size/time/memory limits|Real benchmarks only. Keep route unavailable until defensible provisional limits exist.|No unless limits materially harm intended product usability.|

|Image vulnerability scanner|Prefer SHA-pinned scanner if it adds meaningful container coverage; document waiver process.|No, unless it creates recurring service cost or policy burden.|

## 13. Dependency and Licensing Governance

- Every new runtime/development dependency requires a documented purpose, license review, lockfile impact and alternatives considered.

- LibreOffice is an approved candidate under MPL-2.0 plus bundled notices; qpdf is an approved Apache-2.0 candidate. Verify exact shipped package versions/licenses rather than relying on memory.

- Retain required THIRD_PARTY_NOTICES and relevant image copyright/license material.

- Pin base images by version/digest. Prefer reproducible OS package sources/pinning where practical.

- Do not download unreviewed binaries from arbitrary URLs during builds.

- PyMuPDF and Ghostscript AGPL variants remain prohibited without a separate explicit commercial/legal decision.

## 14. Future Milestone Boundaries

### 14.1 M5 — Hard Tools / Spikes

- Compression benchmark/implementation with truthful profiles.

- PDF→Word fidelity benchmark and explicit GO/DEFER decision.

- Do not pull either into M4.

### 14.2 M6 — Content / SEO

- Canonical functional tool pages, original Learn guides, sitemap/robots/metadata and internal linking.

- Do not generate scaled keyword filler.

### 14.3 M7 — QA / Hardening

- Expanded fixture/browser/accessibility/security/performance matrix.

- Finalize public abuse/rate controls and security hardening not already required earlier.

### 14.4 M8 — Staging / Launch

- Choose production host, DNS/TLS, reverse proxy/body-size controls, monitoring, legal copy, final retention wording and launch gates.

- No Vercel Hobby or other incompatible commercial-use plan.

### 14.5 M9 — Monetization

- AdSense only after product/content/policy readiness.

- No ads inside or adjacent to upload/processing/result critical controls.

## 15. Git, Branch and PR Discipline

- Never force-push protected main. Never bypass required checks.

- Do not reset/clean a dirty working tree unless you have proved which changes are disposable.

- Before every branch: verify main is current and working tree state is understood.

- Commits should be coherent/buildable; do not create artificial partial commits that break package exports/registry wiring.

- Before push: inspect git status, diff stat, full diff, dependency/lockfile diffs and staged content.

- After push: hosted GitHub CI is authoritative for supported Linux/container/browser behavior.

- Never merge without Product Owner manual acceptance for milestone-critical user flows.

## 16. Documentation and Continuity Rules

- Every architecture decision that changes boundaries, processing location, retention/security behavior, engine choice or deployment constraint gets an ADR or an explicit ADR update.

- Benchmark documents contain real measurements, machine/toolchain context and conclusions. Do not leave null/skeleton results and call them evidence.

- Milestone reports state what actually passed, what was not run, what remains manual and what is still a spike. Never claim Product Owner acceptance before it occurs.

- When source code reveals stale wording/counts/docs, correct the drift in the same slice if it is directly caused by the slice.

- Update this handoff document after each milestone or major architecture change so a fresh Claude session can resume without chat history.

## 17. Standard Claude Reporting Format

### 17.1 Planning report

```text
IMPLEMENTATION PLAN — <MILESTONE/SLICE>
1. Repository state
2. Requirements traceability
3. Architecture decisions
4. Exact scope / exclusions
5. Files likely changed
6. Tests and benchmarks
7. Security/privacy/licensing
8. Open decisions
9. Implementation order
10. GO / BLOCKED verdict
```

### 17.2 Completion report

```text
IMPLEMENTATION & VERIFICATION REPORT — <MILESTONE/SLICE>
1. What changed
2. Deviations from plan and why
3. Tests/checks run with exact results
4. Benchmarks with real measurements
5. Security/privacy evidence
6. Dependency/license status
7. Diff audit
8. Commits/branch/PR
9. Known limitations/spikes
10. Product Owner manual tests still required
```

### 17.3 Failure/blocker report

For a genuine blocker, report only: what failed, why routine self-repair is not safe/possible, what decision/access is required from the Product Owner, and the smallest recommended next action.

## 18. New Claude Session Startup Protocol

At the start of any new Claude Cowork or Claude Code session, use this sequence before implementation:

```text
1. Read this handoff file.
2. Read root AGENTS.md.
3. Inspect git status, branch, HEAD, origin/main and recent log.
4. Read the current milestone ADR/report/benchmark evidence.
5. Read the relevant authoritative docs for the slice.
6. Inspect existing source/tests before proposing new abstractions.
7. State the current milestone, current slice, known open decisions and next gate.
8. Continue the existing plan; do not restart architecture from scratch unless evidence requires it.
```

## 19. Reusable Standing Directive for Claude Code

```text
You are the standing senior architect + implementation engineer for this repository.
Follow AGENTS.md and 12_Claude_Engineering_Handoff_Governance.* as binding continuity context.

Operate autonomously on routine engineering work. Inspect → plan → implement → test → benchmark → diff-audit → report. Continue through fixable failures without asking the Product Owner to relay each error.

Never silently change processing mode, privacy/retention promises, licensing posture, milestone scope or major infrastructure. Record binding architecture changes in ADRs.

Do not merge milestone PRs and do not start the next milestone until required CI and Product Owner manual acceptance are complete.

For the current milestone, first identify the approved slice and its gate from this handoff and the current docs/reports. Stop only for a genuine owner decision or blocker.
```

## 20. Current Handoff Point — 17 October 2026

M3 is formally complete and merged. The next engineering work is M4A — Processor Job Core. M4 planning has been completed through architecture review, with the single-container constrained LibreOffice subprocess approach now preferred over the earlier two-container proposal.

- M4A may begin after Claude confirms the repository still matches main c26481e (or a later clean main if this handoff is updated).

- M4A must not install LibreOffice or activate /word-to-pdf. Its purpose is the job/security/lifecycle core using fake engines.

- M4B owns the real LibreOffice/qpdf/font/container spike and the benchmark/security evidence.

- M4C remains gated on a measured and Product Owner-approved retention disclosure before Word→PDF is made available.

- M4D closes the milestone only after full automated evidence, hosted CI and Product Owner manual acceptance.

This document supersedes the need to rely on the previous ChatGPT conversation for project continuity. If a future Claude session finds evidence that this file is stale, update the file and the relevant ADR/report rather than silently following obsolete instructions.
