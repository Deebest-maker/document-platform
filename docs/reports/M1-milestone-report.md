# M1 — Product Shell completion report

Date: 25 September 2026

Status: Implementation and local/hosted verification complete; submitted for owner review through [PR #2](https://github.com/Deebest-maker/document-platform/pull/2). The PR remains unmerged. M2 has not started and requires explicit approval.

## Implemented scope

Roadmap M1, E02/E03 and DEV-004/005/006 are implemented within the approved architecture amendments:

- Homepage with task search, featured planned tools, categories and privacy explanations.
- `/tools` catalog with all 13 MVP records, in-memory search, category filtering, result counts, reset and an honest empty state.
- Minimal shared ToolShell and PrivacyIndicator presentation primitives.
- One `/merge-pdf` preview, explicitly unavailable and noindex. Other tools link to catalog anchors; their individual routes are not generated.
- Shared site navigation and clearly qualified `/about`, `/privacy`, `/terms` and `/contact` placeholders.

Every route remains noindex. The preview has no file picker, upload area, processing/progress simulation, result or download control. No document-processing functionality or M2/M3 infrastructure was introduced.

## Architecture and data flow

The authority is **registry → route metadata → ToolShell → processing-mode/privacy presentation**. [ADR-011](../adr/011-m1-product-shell.md) records the decisions and approved refinements.

1. `packages/tool-registry` contains plain typed records, categories, accepted-type descriptions, processing modes, related slugs, availability, path/metadata helpers, search selectors and the central privacy presentation map. It has no React, Next.js runtime, network or data-service dependency.
2. Home/catalog composition consumes those records. `/merge-pdf` obtains the Merge record and passes it to both the metadata helper and ToolShell. ToolShell passes its `processingMode` to PrivacyIndicator; no per-page privacy-label override exists.
3. Modes represent the approved current MVP intent: Compress is HYBRID; PDF to Word and Word to PDF are SERVER; the other ten records are LOCAL, including PDF to JPG and PDF to Text. A future fallback or mode change requires explicit review of the privacy contract.
4. Privacy wording is qualified as planned. Neutral “Server processing” deliberately refines the UX baseline's “Secure server processing” under the user's explicit amendment. There are no unverified security, retention, encryption, deletion or certification promises.
5. Pages and navigation remain Server Components. Only ToolDiscovery declares a client boundary for local search/category state. Queries are not persisted, placed in URLs, logged or sent to a service. Native disclosures need no custom client logic.
6. UI owns presentation only. ToolShell's idle/selected/processing/result/error slots are tested using synthetic content; the actual preview uses only idle/unavailable content. No file, engine, request or job state lives in UI.
7. The M0 ESLint configuration remains at its existing path. The lint command runs from the repository root and explicitly covers web, registry and UI sources; ignore paths and Next rootDir receive the corresponding small adjustment. Existing TypeScript and Vitest runners cover the shared source. No configuration relocation or new test framework was needed.

## Material files and modules

| Location                                              | Changes                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/tool-registry/`                             | New private workspace package: catalog/types, central privacy copy, selectors and exports                   |
| `packages/ui/`                                        | ToolShell, PrivacyIndicator, exports, small shared stylesheet and three foundation tokens; workspace wiring |
| `apps/web/app/`                                       | Home, catalog, single preview, four trust pages, root layout/styles and render contract tests               |
| `apps/web/components/`                                | Site header/footer, ToolList and interactive ToolDiscovery                                                  |
| `apps/web/tests/`                                     | Registry invariants, processing matrix, selector behavior, shared presentation and privacy derivation tests |
| `apps/web/e2e/`                                       | Discovery, keyboard, responsive, axe, preview restrictions and automatic request/error checks               |
| Web configuration and `pnpm-lock.yaml`                | Shared source lint/type/build/test coverage, workspace dependencies and axe adapter                         |
| `README.md`, `docs/adr/`, `docs/dependency-review.md` | Setup/verification guidance, ADR-011, dependency/license review and this report                             |

The processor, Python lockfile, Dockerfile, GitHub Actions workflow, original product documents and AGENTS.md remain unchanged.

## Verification results

Local checks ran on 24 September; hosted results were confirmed on 25 September.

| Check                      | Result                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`               | Passed formatting, ESLint with zero warnings, strict TypeScript, unit/render tests, production build and browser suite               |
| Vitest                     | **23/23 passed** across registry, shared UI and page rendering                                                                       |
| Playwright                 | **64/64 passed**, desktop Chromium and Pixel 7 mobile Chromium; final local browser run took 4 minutes                               |
| Python locked setup/checks | `uv sync --locked`, Ruff formatting/lint, strict mypy and **2/2 pytest tests passed**                                                |
| Container regression       | Image build and unchanged M0 restricted-container smoke passed: health JSON, UID 10001 and absence of pytest; test container removed |
| Dependency audits          | `pnpm audit --audit-level=high` and locked `uv audit` passed with no known vulnerabilities; uv reported no adverse statuses          |
| Privacy/browser checks     | No unexpected third-party, processing, upload or mutation requests; no browser runtime errors in covered journeys                    |
| Source control             | Source and documentation only; caches, local environments, build output, browser evidence and local helpers remain ignored           |

Registry tests cover unique valid slugs, reserved-route collisions, categories, modes, accepted-type descriptions, resolving related references, the independent approved processing matrix, search behavior and preview links. Consumer tests verify registry-driven home/catalog content and Merge metadata/heading/privacy presentation, including mode changes without separately authored labels.

### Hosted required checks

Code commit **`bf582e46ceeed23fe0489983213e279dfa142461`** passed both [PR verification](https://github.com/Deebest-maker/document-platform/actions/runs/36057737714) and [push verification](https://github.com/Deebest-maker/document-platform/actions/runs/36057732804) on GitHub-hosted Ubuntu runners:

| Required job          | Result | Evidence                                                                                                         |
| --------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `web`                 | Passed | [Job 107828835910](https://github.com/Deebest-maker/document-platform/actions/runs/36057737714/job/107828835910) |
| `processor`           | Passed | [Job 107828836375](https://github.com/Deebest-maker/document-platform/actions/runs/36057737714/job/107828836375) |
| `processor-container` | Passed | [Job 107828836258](https://github.com/Deebest-maker/document-platform/actions/runs/36057737714/job/107828836258) |

The workflow retains its M0 name and required job identifiers. Hosted installs use frozen/locked dependencies. The failure-artifact step is conditional and correctly did not run on success; no required check was skipped. This report is appended in a documentation closeout commit; [PR checks](https://github.com/Deebest-maker/document-platform/pull/2/checks) provide the latest commit's results.

Main protection still requires an up-to-date PR with all three GitHub Actions checks, enforces administrators, and prohibits force pushes and deletion. These settings were inspected without alteration.

### Failures and corrections

- Initial local grouped browser journeys timed out while verification tasks competed for resources. Journeys were split by route/state and browser concurrency bounded to one worker locally and two in CI. Both browser projects, every assertion, default 30-second test timeout and zero retries were retained. The complete final suite passed.
- The first hosted run found a real axe target-size failure on the Merge privacy link: a 15px link was too close to the preceding action. It now uses the existing 44px link treatment, with an explicit target-height regression assertion. The four affected desktop/mobile axe cases and all remaining browser tests passed afterward.
- Early local container startup attempts exceeded the unchanged smoke retry window on the busy host. After the web run completed, the same image, limits and smoke script passed, with two normal startup retries. No Docker settings or checks were weakened; hosted container verification also passed.

## Accessibility and visual review

- Axe checks passed for seven routes in initial and expanded-disclosure states, plus matching/empty discovery results, on both Chromium projects. WCAG 2 A/AA, 2.1 A/AA and 2.2 AA rule tags are enabled.
- Keyboard tests passed for skip-to-main focus, search, reset, native privacy disclosure, visible focus outline and an unobscured focused target. Landmark, heading and result-announcement assertions passed.
- Home, catalog and preview passed 320px reflow with 200% root text and reduced motion. Search remains usable in this state; no horizontal overflow was found.
- Desktop and mobile screenshots of those three routes were manually inspected, along with enlarged-text screenshots. The shell uses restrained neutral colors, system typography, clear hierarchy and flat tool rows. Mobile controls stack, privacy labels wrap, and the preview remains visibly unavailable. At the deliberately narrow enlarged-text setting, long headings wrap over multiple lines without overlap or content loss.

Screenshots are local ignored evidence under `apps/web/test-results/`: the `shell-*` folders contain `home.png`, `tools.png` and `merge-pdf.png` for desktop/mobile; `privacy-accessibility-*` folders contain the corresponding `reflow-*.png` files. They are regenerated by `pnpm test:e2e` and are not committed as product assets.

This is not a full WCAG conformance assessment. Physical-device, assistive-technology and the expanded cross-browser release matrix remain outside this Chromium milestone verification.

## Dependencies and privacy/security

The only new external package is the approved development adapter **`@axe-core/playwright@4.13.0`, MPL-2.0**, verified against published and installed metadata. Its axe-core dependency was already locked. No existing external dependency versions changed. The installed Windows inventory contains 403 package records, with no AGPL or unknown license categories. Existing notice obligations and the ESLint 9 compatibility constraint remain documented in [dependency review](../dependency-review.md).

No documents are accepted or uploaded. The UI does not request or read documents; search text remains in memory and is excluded from URLs, logs and analytics. No document logging, analytics, advertising, remote fonts, cloud storage, accounts, databases, Redis, queues, AI, PDF libraries, workers, conversion engines or processor job endpoints were added. Browser request auditing observes only public preview navigation and synthetic search interactions. The existing processor access-log and framework telemetry settings are preserved.

## Deviations, limitations and unresolved decisions

There are no unapproved scope or architecture deviations. ADR-011 captures the reviewed preview exception, neutral server wording, current-mode semantics and minimal lint adjustment. Bounded browser concurrency and independently named tests refine verification without reducing coverage or checks.

All tools remain unavailable; accepted-type descriptions are not validators. Trust/legal/contact text and branding are intentionally unfinished. Production SEO, deployment, final policy/business identity, operational document limits and later server lifecycle/conversion decisions remain at their documented checkpoints. No unresolved architecture decision blocks M1 review. PR review/merge and explicit milestone acceptance remain owner actions.

## Delivery and next milestone

- Branch: `feat/m1-product-shell`, targeting protected `main` through PR #2.
- Main implementation commit: `a06c700e82313b3ea988b277e2b84bca5407ffba`.
- Accessibility correction / verified code commit: `bf582e46ceeed23fe0489983213e279dfa142461`.
- Recommended next step after approval: plan and implement the documented M2 local PDF workflow, beginning with its first usable Merge slice and privacy/output-validity tests. Any transition from planned labels to functional behavior must keep the registry/privacy contract accurate.

**Stop here. M2 requires explicit approval under AGENTS.md.**
