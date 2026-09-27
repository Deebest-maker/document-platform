# M2A Merge benchmark evidence

Measured 25 September 2026 on Windows, Intel Core i5-1145G7, 16 GiB RAM, Playwright Chromium 153.0.8010.12. All input documents are deterministic, synthetic text or unique noise-JPEG pages. No user documents or filenames were measured or logged.

## Method and worker decision

`tests/fixtures/generate_benchmarks.py` authors ignored local PDFs using already available ReportLab/Pillow. `apps/web/benchmarks/run-merge.mjs` uses the existing locked Vite/Vitest and Playwright tools, a localhost static harness, browser File objects and the real Merge interface. Every case runs three times at normal page CPU speed and three times with CDP's 4× **page-main-thread** throttle. A 16-ms interval measures scheduling delay; PerformanceObserver counts main-thread long tasks (50 ms or more). Every result is checked for its expected page count and output size. Timings cover the operation, including per-job worker startup in worker runs; initial main-thread module loading occurs before timing.

CDP page throttling does **not** emulate worker CPU speed or a physical mobile device. Worker/main-thread throttled durations are not an equivalent throughput comparison. OS scheduling and device load can delay timer probes even without a long JavaScript task. These are diagnostics, not public performance promises or a full memory profile.

The main-thread image cases showed repeated blocking on every throttled repeat: 10 pages produced 2–3 long tasks and 191–284 ms maximum timer delay; 50 image pages produced 11–12 long tasks per run, tasks up to 353 ms, and timer delays up to 366 ms. This satisfies the approved trigger. M2A therefore uses a dedicated worker behind the same async API, with genuine termination on cancellation. There is no main-thread fallback.

## Representative results

Ranges cover three repetitions. Raw records are retained alongside this document.

| Case / input distribution           | Main-thread normal duration | Worker normal duration | Main-thread 4× longest task | Worker main-thread long tasks, all six runs |
| ----------------------------------- | --------------------------: | ---------------------: | --------------------------: | ------------------------------------------: |
| 10 text pages / 2 files             |                     9–69 ms |              72–112 ms |                      183 ms |                                           0 |
| 50 text pages / 5 files             |                   33–104 ms |             101–127 ms |                        0 ms |                                           0 |
| 100 text pages / 2 files            |                   75–119 ms |             152–169 ms |                       99 ms |                                           0 |
| 240 text pages / 12 files           |                  195–411 ms |             291–309 ms |                       76 ms |                                           0 |
| 40 one-page files                   |                   61–603 ms |             136–155 ms |                       62 ms |                                           0 |
| 10 image pages / 2 files / 10.1 MiB |                   58–178 ms |             137–179 ms |                      242 ms |                                           0 |
| 50 image pages / 5 files / 50.4 MiB |                  245–525 ms |             319–508 ms |                      353 ms |                                           0 |

Worker timer delay remained 1–5 ms at normal page speed in the initial comparison; the throttled series had an outlier of 127 ms despite no long tasks. A later boundary run was substantially slower, demonstrating host/load variability: 20 files/200 text pages completed in 1.49–5.447 seconds; six files/30 image pages (31,687,929 input bytes) completed in 2.552–5.611 seconds. All 12 boundary outputs passed within the actual configured caps; there were no observed main-thread long tasks. The largest boundary timer delay was 469 ms in one throttled text run. A worker prevents PDF code from occupying the UI thread, but does not guarantee zero scheduling delay under all host conditions. No failed workload was removed from the recorded runs.

## Configured limits

| M2A engineering cap   | Evidence / rationale                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20 selected files     | Below the explored 40-file workload; exactly 20 files tested in boundary runs.                                                                                 |
| 10 MiB per input      | Below the largest explored image input (about 10.1 MiB); larger inputs fail before full reads.                                                                 |
| 32 MiB combined input | Below the 50.4 MiB stress case; approximately 30.2 MiB tested inside the selected caps.                                                                        |
| 200 total pages       | Below 240 explored pages; exactly 200 verified with 20 input files.                                                                                            |
| 32 MiB output         | Approximately 30.2 MiB output verified inside this cap; larger 50.3 MiB outputs explored separately. Oversize outputs are discarded, not offered for download. |

These conservative caps are centralized in the Merge registry record. They are **temporary M2A engineering limits**, not final public launch limits. Browser memory cannot be hard-capped with this API. More real-device, physical-mobile, PDF-complexity and broader browser evidence is needed before final launch sizing; no server fallback is permitted for this LOCAL tool.

## Reproduce

The ordinary suite uses checked-in small fixtures and needs no Python PDF libraries. Optional benchmark authoring requires ReportLab/Pillow outside the application/processor environments:

```sh
python tests/fixtures/generate_benchmarks.py
node apps/web/benchmarks/run-merge.mjs --main-thread
node apps/web/benchmarks/run-merge.mjs
node apps/web/benchmarks/run-merge.mjs --boundary
```

Run benchmarks without concurrent heavy builds/tests. Outputs go to ignored `.tools/merge-benchmarks/`. Boundary cases intentionally repeat independently selected synthetic files to exercise count/page/byte caps. Normal comparison runs use exploration ceilings above product limits. Retained evidence: `m2a-main-thread.json`, `m2a-worker.json`, `m2a-boundary.json`.
