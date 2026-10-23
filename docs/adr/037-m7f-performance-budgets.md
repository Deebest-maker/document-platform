# ADR-037: Performance budgets: measured limits for weight, first use, layout shift, paint and tap response, enforced by the build

**Status:** Implemented under the approved M7 gate; owner acceptance pending
**Date:** 2026-10-24
**Scope:** Numbers that a page must stay inside, found by measuring the production build and then written into a browser test that fails the build when one is passed; and the two changes the measurements showed were needed: the tool workspace keeps its height while a file is being read (the page was jumping), and the vendored PDF.js files are cached for a year (they were re-checked on every visit). No change to what any tool produces, to any limit on files, or to where a file is processed.
**Relates to:** NFR-PERF-001 (Core Web Vitals on tool landing pages), NFR-PERF-002 (local operations start without a server round trip), NFR-PERF-003 (large libraries load on demand), NFR-PERF-006 (static content cacheable by a CDN), NFR-PERF-007 (numeric limits decided after benchmarks), SRS section 17 (budgets to be inserted as versioned requirements before launch), document 08 sections 8 and 10 (performance benchmarks; no severe layout shift or task-blocking regression), governance section 14.3 (M7 performance matrix), ADR-034 (the post-build manifest that lists every page), ADR-036 (the accessibility matrix this change must not break).

## Context

Until now the product had per-tool benchmarks (merge, organize, split, PDF to JPG, compress and the rest each measured their own heavy work on large files) and no statement about the pages themselves: how much a visitor downloads, what is loaded before anyone asks for it, whether the page moves under a finger, how soon something appears. SRS section 17 and NFR-PERF-007 deliberately deferred the numbers until there was something to measure. M7F measures, picks the numbers, and makes them fail the build.

I measured the production build (`next build`, `next start`) in Chromium at a 412 by 915 CSS px phone viewport, on a throttled "slow phone" (150 ms latency, 1.6 Mbps down, 750 kbps up, CPU slowed 4 times), before writing any number down. Sizes are gzip at level 9. The results, in [`docs/benchmarks/M7F-performance.md`](../benchmarks/M7F-performance.md), were mostly good news and one real problem:

1. **What is downloaded is small and does not depend on the tool.** Every one of the 27 pages loads 159 to 192 KB in 17 to 25 requests (script 137 to 160 KB, style 6.7 KB, HTML 2 to 6 KB). The three PDF libraries are not in it: PDF.js (and its worker) and pdf-lib are fetched when a file is chosen, which is what NFR-PERF-003 asks for. The heaviest pages are the guides that link to several tools, because the browser prefetches the linked pages' scripts while it is idle.
2. **Pages paint soon and hold still while loading.** Largest Contentful Paint 580 to 684 ms on the slow phone, layout shift 0 on every page.
3. **Choosing a file made the page jump.** The idle workspace (a large file picker) is replaced by a short "working" panel and the long guide beneath it jumps up; when the result arrives it jumps down again. Cumulative layout shift after choosing a file, measured with the workspace as it was: Split 0.248, Organize 0.187, PDF to JPG 0.255, Extract 0.250, Delete 0.250, Rotate 0.243, Remove Metadata 0.161 (Google calls anything over 0.25 "poor" and under 0.1 "good"). This is the finding that needed a change.
4. **The PDF.js files that never change were not cached.** The character maps, standard fonts, WebAssembly and manifest sit in a folder named for the library version (`vendor/pdfjs/6.3.289/`) and were served with `max-age=0`, so a returning visitor's browser asked again for each one it needed. They are the biggest files the product serves (1.1 to 1.9 MB each folder, loaded only when a document needs them).
5. **A tap on a 50-page document is answered in 48 to 120 ms** on the slow phone, against 500 ms where Google's measure turns "poor". Nothing to fix.
6. **Time spent in long tasks is moderate and reported, not enforced.** On the 4 times slower CPU a page load has one to three tasks over 50 ms, the longest 177 to 283 ms, for 134 to 242 ms of blocking time in total. This is what a slow phone costs for the framework's start-up, the same on every page, and it is noisy from one run to the next.

## Decisions

**1. The budgets.** `apps/web/e2e/performance-budgets.spec.ts` holds them in one object, `BUDGET`, at the top of the file. Each limit is the largest value measured with headroom, except where an outside standard gives the number (marked).

| What                                                                    | Measured (worst page)         | Limit                                               |
| ----------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------- |
| Script on first load, every page (gzip)                                 | 160.3 KB                      | 180 KB                                              |
| Style on first load                                                     | 6.7 KB                        | 10 KB                                               |
| HTML document                                                           | 6.4 KB                        | 15 KB                                               |
| Everything on first load, including prefetch                            | 191.5 KB                      | 230 KB                                              |
| Requests on first load                                                  | 25                            | 35                                                  |
| A PDF engine in the first load                                          | none                          | none                                                |
| Script fetched when the first file is chosen, PDF.js tools              | 496.1 KB                      | 560 KB                                              |
| The same, Remove PDF Metadata (pdf-lib only)                            | 178.3 KB                      | 220 KB                                              |
| Layout shift while a page loads                                         | 0                             | 0.02                                                |
| Layout shift after choosing a file                                      | 0.086 (Merge, in a wide font) | 0.1 (Google "good")                                 |
| Largest Contentful Paint, slow phone                                    | 684 ms                        | 2500 ms (Google "good")                             |
| Slowest tap on a 50-page document, slow phone                           | 88 ms                         | 500 ms (Google "poor" begins)                       |
| Cache-Control of `_next/static` files and of every vendored PDF.js file | `max-age=31536000, immutable` | the same                                            |
| Cache-Control of a page                                                 | `s-maxage=31536000`           | cacheable (not `no-store`, `no-cache` or `private`) |

The byte limits are 12 to 49 per cent over the measured maximum: tight enough that adding a library, a font or a second copy of something to the first load fails, loose enough that a new paragraph or a small component does not. The time limits are deliberately loose, because time varies with the machine running the test: they catch a page that has become several times slower, not a few per cent. Raising a limit is a decision and needs an ADR that says why, so that a budget cannot be quietly spent.

**2. What is enforced and what is only recorded.** Enforced: bytes, request count, which libraries load when, cache headers, layout shift, and the loose ceilings on paint and tap time. Recorded, not enforced: long tasks and total blocking time (a handful of tasks of 200 to 300 ms under a 4 times slower CPU, different on every run), and the exact tap times. They are in the benchmark (`apps/web/benchmarks/run-performance.mjs`, results in `docs/benchmarks/M7F-performance-results.json`) so that a trend is visible, but a number that moves 30 per cent between two identical runs cannot fail a build without making the build flaky.

**3. The test covers every page, and finds new ones by itself.** The list of pages comes from `.next/csp-manifest.json`, the post-build manifest ADR-034 writes for the security policy, which lists every page the build made (27 today). A new page is inside the budget test the day it exists; nobody has to add it.

**4. The engine check is a check on content, with a control.** "No PDF engine in the first load" is tested by looking for text that exists only in PDF.js and pdf-lib (their error names) in every script a page loads, and a second test, in the same file, chooses a file on five tools and requires that the engine is seen then and that it is within its budget. If the detection ever stopped working, the second test would fail; a check that can only pass is not a check. A Web Worker's own script is reported by the browser as type "other", not "script", and PDF.js's worker is 355 KB of the 495, so every file is classed by its name (`.js`, `.mjs`) as well as its type. My first version missed the worker and understated the first-use cost by three quarters; the test now counts it, and the budget is set from the real figure.

**5. The workspace holds its height while a file is being read.** `ToolShell` (`packages/ui/src/tool-shell.tsx`, now a client component) records the workspace's height whenever it is not processing and, while it is processing, sets that height as its minimum. The short "working" panel appears inside a box as tall as the picker it replaced, so nothing below it moves; when the result arrives the box returns to its natural height. Layout shift after choosing a file falls from 0.16 to 0.26 on seven tools to 0.02 or less in the build test's own run, and never above 0.09 in any measurement I took (slow phone, wide font). What remains is the page growing because the visitor added something (a file list appearing in Merge): content that was asked for, and inside Google's "good" band. It is a one-element change in the shell the tools share; no tool's own code changed.

**6. Files that never change are cached for a year.** The Next configuration (production only, where the other headers already are) adds `Cache-Control: public, max-age=31536000, immutable` for `/vendor/pdfjs/:version/:path*`. The folder name is the library version, so a different version is a different URL and nothing can be stale. `_next/static` already had the same header. Pages keep Next's `s-maxage=31536000`, which a CDN may hold; the test only requires that they can be cached.

**7. Layout shift, paint and tap time are measured in one project.** They are Chromium measurements (Firefox and WebKit do not report them the same way) and the budgets are for a phone, where the long guide below a tool sits at the fold and its shifts count; on a 1280 by 720 desktop viewport it is below the fold and they do not. The "what a visitor feels" tests therefore run in the phone-sized Chromium project only. The weight, engine and cache tests run in every project, and their results do not depend on the browser.

**8. The tests can fail.** I broke each protected property one at a time and ran the test: a PDF library imported statically into the page shell (fails naming the file; the first load becomes 318 KB of script against a limit of 180), the immutable header removed (fails naming the URL), the workspace height hold disabled (fails with layout shift 0.19 to 0.26 on the PDF tools), a 700 ms busy loop on the reorder button (fails with 776 ms), a banner that appears 300 ms after load (fails with layout shift 0.25 on every page). Each was restored and the suite run again. My first pass was wrong in two ways, and the list is the corrected one: the engine mutation I first wrote imported a module that loads pdf-lib on demand, which is not a regression and was correctly not caught; and the height-hold mutation was run on the desktop project, where the shift is out of view and is not counted, which is why the vitals tests now run in the phone project only (decision 7).

## Why not more

- **Lighthouse in CI.** It would give a familiar score, but the score mixes several measures, varies a lot between runs on shared runners, and its pass mark would be a number nobody here chose. The same measures are taken directly, with limits written down.
- **Enforcing long tasks and total blocking time.** They are the measure a slow phone feels most and also the noisiest. They stay in the benchmark.
- **Real-user monitoring.** It means sending timing data from visitors' browsers to a service; the product's position is that it collects nothing it does not need. Field data belongs to the post-launch period (M9) and needs its own decision.
- **Brotli sizes.** The host decides whether it serves brotli; gzip level 9 is the conservative number every host can meet. If the host serves brotli the pages are smaller than reported.
- **Reserving space for the Merge and Images to PDF lists.** Their remaining layout shift (0.04 to 0.09) is the page growing with what the visitor added. Reserving empty space for a list that may have two items would add a gap on every visit to avoid a small shift on some.
- **A service worker or more prefetch tuning.** The first load is already 159 to 192 KB; the gain is small and the risk (a stale cached page) is not.

## Known limitations

1. **Lab numbers, not real devices.** The "slow phone" is a throttled desktop Chromium. A mid-range Android phone on a poor connection is the M7G device check; its results may justify tightening or loosening a time limit.
2. **One browser engine for time and shift.** Firefox and Safari do not report layout shift or event timing the same way; they are covered for weight, laziness and caching.
3. **A CDN purge is needed on every deploy.** Pages are served with `s-maxage=31536000`, so whatever sits in front of them must be purged (or keyed by build) when a new build is published, or visitors keep the old page. A note for M8.
4. **Local operations on large files are not in this test.** How long merge, organize, split, compress and the rest take on large documents is in their own benchmarks (M2A, M3A.1 to M3B.4, M5A) and their limits; M7F covers the pages around them.
5. **A third-party script would trip the budgets, as it should.** The first-load script limit is also a statement that nothing is added to every page without a decision. Advertising (M9) will have to be weighed against it.

## What changed

- `apps/web/e2e/performance-budgets.spec.ts`: the budgets and the six tests (new).
- `apps/web/benchmarks/run-performance.mjs`, `docs/benchmarks/M7F-performance.md`, `docs/benchmarks/M7F-performance-results.json`: the measurements (new).
- `packages/ui/src/tool-shell.tsx`: the workspace holds its height while processing.
- `apps/web/next.config.ts`: immutable cache header for the vendored PDF.js files.
- Records: this ADR, the M7F report; M7E's merge recorded in ADR-036, the ADR index, the M7E report and the governance M7 row.
