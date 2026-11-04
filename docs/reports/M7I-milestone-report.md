# M7I Milestone Report: Requirement-to-test table

**Date:** 2026-11-04
**Status:** Accepted by the Product Owner on 2026-11-04; merged (`1ee0994`)
**Preceding slice:** [M7H](M7H-milestone-report.md) — a dropped connection is no longer blamed on the file (accepted 2026-11-04 and merged, `4d5c824`).
**Part of:** M7 QA and hardening (governance §14.3), follow-up to [M7G](M7-milestone-report.md) finding 4.
**Decision record:** none. This is documentation and a check script; it makes no product or architecture decision.

## Summary

Document 08 §12 and SRS §16 say every P0 requirement and every launch-critical non-functional requirement must map to at least one automated test or documented manual check. `docs/qa/requirements-traceability.md` is that map, for all 102 SRS requirements, with a status, the files that cover each one and a note wherever coverage is not complete. A script keeps it true, and nothing a visitor sees has changed.

**Totals:** Automated 66, Partial 17, Manual 2, Gap 2, Deferred 15 (102 in all).

## What I found

1. **Six requirement IDs in the repository were wrong.** Tests and an ADR named requirements the SRS does not have: numbers 004, 005 and 006 of the metadata group, number 004 of the PDF to JPG group, and a UX-specification ID written as a non-functional requirement (twice). I corrected the test titles and ADR-020 to the requirements they really exercise. The script now finds this kind of mistake, including after a slash, where a short form like `001/004` had hidden one.
2. **CI skips the tests that use the real LibreOffice and qpdf.** The runner has neither: 8 processor tests that convert with LibreOffice and 4 that check PDFs with qpdf are skipped on every run (236 passed, 13 skipped on the last `main` run; the 13th is a platform quirk in a ZIP test). The real engine was exercised in the M4D benchmark, but nothing re-checks it on each change. Five rows are Partial for this reason (FR-W2P-002, NFR-SEC-002, -003, -004, NFR-REL-001).
3. **No test drives a page against the real processor.** The Word to PDF browser test answers from a mock and the processor tests call the API directly. The path between them (page, proxy, processor) is first exercised on the M8 staging site.
4. **Two gaps, both small:** nothing asserts that no tool asks for an email address (FR-GEN-007), or that a server error log line carries the job identifier (NFR-OBS-003).
5. **Fifteen requirements are deferred, each to a named milestone:** PDF to Word (4, V1.1), ads (5, M9), and 6 for M8 (analytics, monitoring, rollback, and the privacy review of both).
6. **Accessibility is automated, not human-verified** (NFR-A11Y-006 is Partial). This repeats M7 decision 5: no Safari, iPhone or screen-reader run is recorded.

## The check

`pnpm check:traceability` (also run by `pnpm test`, and as its own CI step) fails when a row is malformed, a cited file does not exist, a requirement is added or dropped (the SRS group sizes are pinned in the script), a requirement ID written anywhere in the repository does not exist, a test names a requirement but is not listed on its row, a Gap or Deferred requirement is named by a test, or the totals line is wrong. `--strict` also fails on every Gap and every requirement deferred to M8: it is the form to run at the M8 gate, and today it reports 8 (the 2 gaps and the 6 M8 items).

## Verification

- **Real repository:** `pnpm check:traceability` passes; 102 rows, every cited file exists, every ID in the repository is real, and every test that names a requirement is listed on its row (the first run found 9 omissions in my draft table, which I fixed).
- **New tests (`apps/web/tests/traceability.test.ts`, 29):** the real table passes; ID shorthand (`001/004`, `001..003`, `001, 002`) is read correctly; each rule above fails on a small bad table and passes on a good one.
- **Suites:** 315 library (unchanged) and 452 web (up from 423, the 29 new ones) unit tests pass. Type check, lint and format check pass.
- **Browser tests:** unchanged apart from three test titles (the corrected IDs); CI runs them.

## Known limitations

- **The table lists files, not single tests.** A listed file covers a requirement when at least one test in it does. The script checks that the file exists and that tests naming a requirement are listed, not that the listed file truly covers it. That stays a review question, and the statuses are my reading of the tests, for you to check.
- "Automated" means tests that run in CI. Where some of the covering tests do not run there (finding 2), the row says Partial.
- Statuses can only go stale when a row is not updated. The script catches an ID or file that disappears, not a test that stops covering what it covered.

## Deviations from documentation

None. Document 08 asks that tests "reference SRS IDs in names/metadata where practical"; about half of the tests that matter now do, and the table covers the rest by file.

## Security and privacy

No product code changed. The only outside read was the repository's secret-scanning setting (switched on, with push protection), recorded on the NFR-SEC-007 row.

## Files

- New: `docs/qa/requirements-traceability.md`, `scripts/check-traceability.mjs` (and `.d.mts`), `apps/web/tests/traceability.test.ts`.
- Changed: `package.json` (script), `.github/workflows/ci.yml` (one step), test titles in `apps/web/e2e/remove-pdf-metadata.spec.ts` and `apps/web/e2e/pdf-to-jpg.spec.ts`, ADR-020 (one ID).
- Records: M7H marked accepted and merged (`4d5c824`) in ADR-038, the ADR index, the M7H report, the M7 report and the governance M7 row; this report; the M7 report and governance row for M7I.

## Decisions for you

1. **Accept M7I:** accepted 2026-11-04, merged `1ee0994`. Please read the two lists that matter: the 17 Partial rows and the 2 Gap rows (they are the honest part of the table).
2. **The real-engine tests that CI skips (finding 2).** Either run them inside a test build of the processor image in CI, as a small slice before M8, or accept the gap until the M8 staging smoke test. My recommendation: the small slice. Without it, a regression in Word to PDF would go unseen until staging.
3. **Next:** M8 needs the production domain, brand name, author line and a hosting budget. Until then there is little left to build, apart from the optional slice in decision 2 and the iPhone and Safari run, which I would do on the M8 staging site.
