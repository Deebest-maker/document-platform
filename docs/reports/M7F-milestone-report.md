# M7F Milestone Report: Performance budgets

**Date:** 2026-10-24
**Status:** Implemented; owner acceptance pending
**Preceding slice:** M7E — accessibility (accepted and merged, `1a8d5b0`; main's CI on that commit passed in all five browsers on its second attempt: the first hit one WebKit "internal error" while loading a page, a browser fault, and the same job passed when re-run).
**Part of:** M7 QA and hardening (governance §14.3), slice F of seven.
**Decision record:** [ADR-037](../adr/037-m7f-performance-budgets.md). Measurements: [`docs/benchmarks/M7F-performance.md`](../benchmarks/M7F-performance.md).

## Summary

The pages now have numbers they must stay inside, found by measuring the production build and enforced by a browser test: how much a visitor downloads, which libraries load when, how much the page moves, how soon it paints, how fast a tap is answered, and what a browser may cache. Two things needed fixing and are fixed: the page jumped when a file was chosen, and the PDF.js files that never change were being re-checked on every visit.

Nothing changes for what a tool produces. A visitor sees one difference: the page no longer jumps when a file is chosen.

## What I found, and what changed

1. **First load is small and the same for every tool.** All 27 pages load 159 to 192 KB (gzip) in 17 to 25 requests. No page loads a PDF library before a file is chosen; PDF.js and pdf-lib are fetched when a file is chosen (495 KB for the PDF.js tools, 178 KB for Remove PDF Metadata, nothing for Merge and Compress). Nothing to change.
2. **The page jumped when a file was chosen.** Layout shift 0.16 to 0.26 on seven tools (Google calls over 0.25 poor, under 0.1 good), because the large file picker was replaced by a short "working" panel and the guide below it jumped up, then down again. **Fixed** in the shared tool shell: the workspace keeps its height while a file is read. Shift is now 0.02 or less in the test, and never above 0.09 in any measurement I took.
3. **PDF.js's character maps, fonts and WebAssembly were re-checked on every visit.** They sit in a folder named for the library version and were served with `max-age=0`. **Fixed:** cached for a year (`immutable`), as the built scripts already were.
4. **Pages paint soon and hold still.** On a throttled slow phone (150 ms latency, 1.6 Mbps, CPU 4 times slower) the largest paint is at 580 to 684 ms and layout shift while loading is 0 on every page. A tap on a 50-page document is answered in 48 to 120 ms. Nothing to change.
5. **Time lost to start-up work is moderate** (one to three tasks over 50 ms on the slow CPU, the longest 177 to 283 ms), the same on every page, and different on every run. It is recorded in the benchmark and not enforced, so it cannot make the build flaky.

## The budgets

| What                                                     | Measured (worst page) | Limit                |
| -------------------------------------------------------- | --------------------- | -------------------- |
| Script / style / HTML on first load (gzip)               | 160 / 6.7 / 6.4 KB    | 180 / 10 / 15 KB     |
| Everything on first load, and requests                   | 191.5 KB, 25          | 230 KB, 35           |
| A PDF library in the first load                          | none                  | none                 |
| Script fetched when the first file is chosen             | 496 KB (178 pdf-lib)  | 560 KB (220 pdf-lib) |
| Layout shift while loading / after choosing a file       | 0 / 0.086             | 0.02 / 0.1           |
| Largest Contentful Paint, slow phone                     | 684 ms                | 2500 ms              |
| Slowest tap, 50-page document, slow phone                | 88 to 120 ms          | 500 ms               |
| Cache-Control of built scripts and vendored PDF.js files | one year, `immutable` | the same             |
| Cache-Control of a page                                  | `s-maxage=31536000`   | cacheable            |

The byte limits are 12 to 49 per cent above what I measured: a new library or a second copy of something in the first load fails; a new paragraph does not. The time limits are deliberately loose. Raising any limit needs an ADR.

## Verification

- **The test:** `apps/web/e2e/performance-budgets.spec.ts`, six tests: weight and "no library in the first load" for every page the build made (found from the build's own manifest, so a new page is covered automatically); a library is fetched on first use and within its budget (which also proves the detection can see a library); cache headers; layout shift, largest paint and tap time on the phone-sized Chromium project. The weight, library and cache tests run in every browser project; the layout, paint and tap tests run in the phone-sized Chromium project. They pass here, and also with the wide font CI uses.
- **The tests can fail.** I broke five things one at a time: a PDF library imported statically into the page shell (fails: 318 KB of script against 180), the cache header removed (fails naming the file), the height hold disabled (layout shift 0.19 to 0.26 on the PDF tools), a 700 ms busy loop on the reorder button (776 ms against 500), a banner appearing 300 ms after load (layout shift 0.25 on every page). Each was restored.
- **The shared tool shell changed, so I ran everything.** Desktop and phone Chromium, whole suite: 405 pass, 32 fail (16 per project), exactly the failures there were before this change and for the same reasons: 8 that fail on unmodified `main` here, the 7 password-protected cases from M7D, and PDF to JPG's result state in the accessibility matrix, environment-specific, and passing in CI. The accessibility matrix (70 states per project) passes everywhere except PDF to JPG's result state, which cannot be reached here (as before). Every other test, including every tool's end-to-end tests, passes with the new shell.
- **Unit tests:** 420 pass. Lint, types, format and the production build pass.
- **Five-browser CI:** all five browsers pass at `f7a6a10` (the code last changed in `db56b91`; later commits change only this report): desktop and phone Chromium, Firefox, WebKit and phone WebKit (217 pass and 3 skipped on each desktop project, where the three phone-only layout tests do not run; 220 on phone Chromium), plus the processor tests, the processor container build and the web quality job with the dependency audit. This includes the PDF to JPG result state and the password-protected cases that cannot run on my machine.
- **Not verified:** real phones and real networks (M7G); Firefox and Safari timing (they do not report layout shift and event timing the way Chromium does); brotli sizes; a CDN in front of the pages.

## Known limitations

1. **Lab numbers.** A throttled desktop browser is not a mid-range Android phone on a poor connection. M7G runs the device check and may justify tightening or loosening a time limit.
2. **A CDN purge is needed per deploy.** Pages are served with `s-maxage=31536000`, so whatever sits in front of them must be purged (or keyed by build) on every release. A note for M8.
3. **Large-file speed is not here.** How long merge, split, organize, compress and the rest take on large documents is in their own benchmarks; this slice covers the pages around them.
4. **Remaining layout shift** (Merge 0.02 to 0.09) is the page growing because the visitor added files. It is inside Google's "good" band and I did not reserve space for it.
5. **Advertising will meet this budget.** Nothing is added to every page without a decision; M9 will have to weigh ad scripts against the first-load limit.

## Deviations from plan

- **A flaw in my own test, found and fixed.** My first version did not count PDF.js's worker (the browser reports a worker's script as "other"), so it understated the first-use cost by about three quarters (135 of 495 KB) and the engine budget looked loose when it was not. It now counts by file name as well as type, and the budget is set from the real figure.
- **Two of my five breakage checks were wrong the first time** and the list above is the corrected one: one imported a module that loads its library on demand (not a regression, correctly not caught), and one ran on the desktop project, where the shift is below the fold and not counted. The second showed that the vitals tests must run on the phone-sized project, so they do.

## Decisions

1. **M7F accepted** — for you to say. I will not merge until you do.
2. **The numbers in the table above** are my proposal; they are yours to change. Tighter byte limits mean more failures when someone adds a feature; looser ones let weight creep. I chose "fails on a new library, passes on a new paragraph".
3. **Open for the M7G checklist:** one real mid-range Android phone and one iPhone on a slow connection, reading the same measures (first paint, whether the page jumps when a file is chosen, how quickly a tap on a long list is answered).
4. **Branches.** The 21 throwaway `check/` branches from M7C are still on GitHub; deleting them is not possible from this session (steps were given).

## Recommended next

**M7G — device checklist and the M7 report.** The list of what only a real phone, a real screen reader and Safari and Firefox by hand can show, with the results table for you to fill, and the closing M7 report. I will not start it until you say so.

## Files

- Test: `apps/web/e2e/performance-budgets.spec.ts`.
- Benchmark: `apps/web/benchmarks/run-performance.mjs`, `docs/benchmarks/M7F-performance.md`, `docs/benchmarks/M7F-performance-results.json`.
- Shell: `packages/ui/src/tool-shell.tsx` (the workspace holds its height while processing).
- Cache: `apps/web/next.config.ts` (immutable header for the vendored PDF.js files).
- Records: `docs/adr/037-m7f-performance-budgets.md`, this report; M7E's merge recorded in ADR-036, the ADR index, the M7E report and the governance M7 row.
