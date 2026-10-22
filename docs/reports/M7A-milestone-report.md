# M7A Milestone Report: CI truth

**Date:** 2026-10-22
**Status:** Accepted and merged (`2110313`)
**Preceding milestone:** M6C Learn hub and the retention follow-up (ADR-032), accepted and merged (`d599784`).
**Part of:** M7 QA and hardening (governance §14.3), slice A of seven.

## Summary

The automated checks on `main` have failed on every merge since the M4D merge on 21 October (the last green run on `main` was M4C, 19 October). Pull requests ran only the two Chromium browser projects, which passed; the push to `main` also runs Firefox and the two WebKit (Safari engine) projects, and those were the ones failing. Nobody could see why: the sandbox cannot read GitHub's job logs or artifacts.

This slice makes the checks tell the truth and fixes what they found. Each browser now runs in its own job and a failing test is named on the check run itself. All five browser projects pass on the full run. Of the four faults found, three were in tests and one was a real bug in the product; a fifth item was a diagnostic gap.

## What was found on current `main`

| #   | Where                                       | Cause                                                                                                                                                                                                                                                                                                                                  | Kind           |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | PDF to JPG, Split, page tools (all engines) | If Cancel was pressed at the moment an export was finishing, the page stayed on "Creating…" with a Cancel button that did nothing. The only way out was reloading the page. Now it reports "cancelled", creates no download and keeps the page choices                                                                                 | **Product**    |
| 2   | Compress PDF cancel test (Firefox)          | The test file was larger in Firefox than in Chromium and passed the tool's own 50 MiB input limit, so the tool refused it before it could be cancelled                                                                                                                                                                                 | Test           |
| 3   | Screenshots in two tests (WebKit)           | A full-page screenshot over 32,767 device pixels is refused by WebKit; the test did not count device pixels                                                                                                                                                                                                                            | Test           |
| 4   | PDF to JPG cancel test (Firefox)            | The 50 blank pages export in milliseconds, so Cancel could arrive after the export had finished. Firefox failed this in two different ways across runs. Encoding is now held back so Cancel always lands during the export, and the test clicks normally. I could not run Firefox in the sandbox, so this is confirmed by CI runs only | Test           |
| 5   | Network-request audit helper                | On a failure it reported only a count (expected 0, got 1), not which request or error. It now lists them                                                                                                                                                                                                                               | Diagnostic gap |

Items 2 to 5 changed tests and test helpers only; no product behaviour was changed to make a test pass. Item 1 is the only product change.

## What was implemented

- **Per-browser CI jobs.** `web-quality` (format, lint, types, unit tests, build, dependency audit) and one `web-e2e` job per browser project, each with its own time limit. The single job had grown to within a minute of its 15-minute limit. Pull requests run desktop and phone Chromium; `main`, tags and manual runs also run Firefox, WebKit and phone WebKit.
- **The required check keeps its name.** A small `web` job passes only if every web job passed, so the branch-protection rule (`web`, `processor`, `processor-container`) is unchanged.
- **Readable failures.** After the browser run, `scripts/ci-playwright-annotations.mjs` turns Playwright's result file into annotations on the check run: the failing test, the browser, the first lines of the error, and the number passed. Output is capped and tested (5 unit tests).
- **Late-cancel fix** in the shared page session (`preview-session.ts`), with 4 unit tests that feed an engine that ignores Cancel.
- **Test fixes** for items 2 to 5, and the PDF to JPG cancel test now reports what the page showed when it fails.

## Verification

- **Full run on this branch, all five browser projects:** chromium, mobile-chromium, firefox, webkit and mobile-webkit all pass, with `web-quality`, `processor` and `processor-container`. Firefox had failed one PDF to JPG test in the two earlier full runs, so I ran the full matrix twice on the final commit; both runs passed everywhere. Two passes are good evidence, not proof, that the flake is gone.
- **Local:** format, lint, types and unit tests pass (web 282, libraries 303).
- **The new cancel tests can fail.** Three of the four late-cancel tests fail on the old session code and all four pass on the fix.
- **Not verified:** that Safari on a Mac or an iPhone behaves like Playwright's WebKit on Linux. The WebKit projects are the same engine family, not the real browsers. That remains the device checklist in M7G.

## Known limitations

1. **Local runs still show 14 failures** (7 PDF recovery and image-export tests in two projects), the same ones that fail on unmodified `main` in this sandbox, which has Node 22 where the project requires Node 24. CI is authoritative.
2. **CI logs and artifacts stay unreadable from here.** The annotations are the workaround; they show the first lines of each error, not the whole log.
3. **Pull requests still run only Chromium.** That keeps feedback fast; Firefox and WebKit are checked when something is merged to `main` or when a run is started by hand. A change that breaks only Firefox is therefore found after merging, though it is now visible straight away.
4. **A cancelled-run overlap.** Runs for the same branch cancel each other; starting a manual run within 20 seconds of a push cancels one of them.

## Deviations from plan

None. The slice had been planned as "find why `main` is red and make the browser runs visible"; the split into per-browser jobs follows from the time limit.

## Decisions needed from the Product Owner

1. **Accept M7A**, so it can be merged and `main` can turn green.
2. **Optional:** whether pull requests should also run Firefox and WebKit. It would make each pull request take as long as the slowest browser job (Firefox, about 8 minutes on the last run, against about 3 for Chromium) but finds a Firefox-only break before merging. My recommendation is to keep Chromium on pull requests for now and revisit at M8.

## Recommended next

**M7B** (processor abuse controls, ADR-033) is already built and open as its own pull request. After both are accepted: **M7C**, web security headers and Content Security Policy.

## Files

- CI: `.github/workflows/ci.yml`, `scripts/ci-playwright-annotations.mjs` and `.d.mts`, `apps/web/playwright.config.ts`, `README.md`.
- Product: `apps/web/components/pdf-preview/preview-session.ts`.
- Tests: `apps/web/tests/ci-annotations.test.ts`, `apps/web/tests/export-late-cancel.test.ts`, `apps/web/e2e/fixtures.ts`, `merge.spec.ts`, `shell.spec.ts`, `compress-pdf.spec.ts`, `pdf-to-jpg.spec.ts`.
- Documents: governance M7 row.
