# M7F performance budgets: measurements

Date: 2026-10-23

## Scope

This is a synthetic engineering benchmark of the production build (`next build`,
`next start`), taken to set the performance budgets in
[ADR-037](../adr/037-m7f-performance-budgets.md) and enforced by
`apps/web/e2e/performance-budgets.spec.ts`. It is not a public performance
guarantee and is not field data.

## Method

- **Browser and screen:** Chromium at 412 by 915 CSS px (a Pixel 7 sized phone),
  touch enabled.
- **Slow phone:** 150 ms latency, 1.6 Mbps down, 750 kbps up, CPU slowed 4
  times (Chrome DevTools "slow 4G" with a 4 times CPU throttle). Used for the
  page loads and the first-file measurements, and for the tap test.
- **Bytes:** every response the page receives, compressed with gzip at level 9
  (node `zlib`), counted by kind. A file is counted as script by its type or by
  its name (`.js`, `.mjs`), because a Web Worker's script is reported as
  "other". Prefetched pages count, because the visitor pays for them.
- **Pages:** all 27 pages the build made, read from the post-build manifest.
- **Documents:** blank pages generated for the run, and the project's own
  four-page fixture `tests/fixtures/pdf/preview-features.pdf`. No document-derived
  data is recorded.
- **Timing:** Largest Contentful Paint, layout shift, long tasks (over 50 ms)
  and event timing come from the browser's `PerformanceObserver`. Blocking time
  is the sum over long tasks of the part over 50 ms. These are one run per page
  on one machine; time varies between runs and between machines, so the
  numbers below are for orientation and the build test uses loose ceilings.

## Result

- **First load is small and the same for every tool.** 158.9 to 191.5 KB in 17
  to 25 requests: script 136.6 to 160.3 KB, style 6.7 KB, HTML 2.4 to 6.4 KB.
  No page loads PDF.js or pdf-lib before a file is chosen. The heaviest pages
  are the two guides that link to the most tools (their linked pages' scripts
  are prefetched while idle).
- **Pages paint soon and do not move while loading.** Largest Contentful
  Paint 580 to 684 ms; layout shift 0 on every page.
- **A file brings its engine with it.** Choosing a file on Split, Organize,
  Extract, Delete, Rotate, PDF to JPG or PDF to Text fetches 495 to 496 KB of
  script (PDF.js 135 KB and its worker 355 KB, plus small chunks); Remove PDF
  Metadata fetches 178 KB (pdf-lib only); Compress and Merge fetch nothing.
- **Choosing a file no longer shifts the page much.** Cumulative layout shift
  0 to 0.084 on all ten tools with the workspace holding its height (ADR-037
  decision 5). Without it, the same test measured 0.161 to 0.255 on seven of
  them.
- **A tap on a 50-page Organize document** was answered in 48 to 120 ms on the
  slow phone (browser event timing, several runs).
- **Long tasks while loading** (4 times slower CPU): one to three per page, the
  longest 177 to 283 ms, 134 to 242 ms of blocking time in total. Recorded, not
  enforced.
- **Caching.** `_next/static` and the vendored PDF.js files are
  `max-age=31536000, immutable`. HTML is `s-maxage=31536000`.

### Every page, first load on the slow phone

| Page                                         | Script KB | Total KB | Requests | LCP ms | CLS | Long tasks | Longest ms | Blocking ms |
| -------------------------------------------- | --------- | -------- | -------- | ------ | --- | ---------- | ---------- | ----------- |
| `/`                                          | 141.9     | 171.3    | 20       | 684    | 0   | 2          | 230        | 232         |
| `/about`                                     | 136.6     | 158.9    | 17       | 608    | 0   | 1          | 229        | 179         |
| `/compress-pdf`                              | 145.4     | 170.2    | 18       | 632    | 0   | 2          | 211        | 190         |
| `/contact`                                   | 136.6     | 164.1    | 23       | 580    | 0   | 1          | 202        | 152         |
| `/delete-pdf-pages`                          | 147.6     | 171.8    | 19       | 588    | 0   | 2          | 177        | 134         |
| `/extract-pdf-pages`                         | 147.6     | 171.7    | 19       | 640    | 0   | 2          | 204        | 171         |
| `/jpg-to-pdf`                                | 144.4     | 169.1    | 18       | 592    | 0   | 3          | 215        | 202         |
| `/learn`                                     | 136.6     | 176.1    | 25       | 636    | 0   | 2          | 215        | 189         |
| `/learn/copy-text-from-a-pdf`                | 136.6     | 161.2    | 17       | 620    | 0   | 2          | 230        | 190         |
| `/learn/make-a-pdf-smaller`                  | 136.6     | 161.6    | 17       | 592    | 0   | 2          | 251        | 212         |
| `/learn/merge-pdfs-without-uploading`        | 136.6     | 161.8    | 17       | 632    | 0   | 2          | 234        | 191         |
| `/learn/photos-and-scans-into-one-pdf`       | 136.6     | 161.3    | 17       | 636    | 0   | 2          | 239        | 202         |
| `/learn/save-pdf-pages-as-images`            | 154.8     | 185.8    | 24       | 632    | 0   | 2          | 240        | 210         |
| `/learn/split-a-pdf-or-keep-some-pages`      | 160.3     | 191.5    | 25       | 616    | 0   | 2          | 222        | 184         |
| `/learn/what-processed-on-your-device-means` | 136.6     | 161.3    | 17       | 636    | 0   | 2          | 209        | 173         |
| `/learn/whats-hidden-in-a-pdf`               | 136.6     | 161.2    | 17       | 680    | 0   | 2          | 201        | 165         |
| `/merge-pdf`                                 | 141.9     | 166.5    | 18       | 672    | 0   | 2          | 232        | 211         |
| `/organize-pdf`                              | 147.1     | 171.4    | 19       | 596    | 0   | 2          | 283        | 242         |
| `/pdf-to-jpg`                                | 148.1     | 172.6    | 19       | 644    | 0   | 2          | 237        | 208         |
| `/pdf-to-text`                               | 143.8     | 168.4    | 18       | 628    | 0   | 2          | 208        | 168         |
| `/privacy`                                   | 136.6     | 159.8    | 17       | 600    | 0   | 2          | 237        | 189         |
| `/remove-pdf-metadata`                       | 145.6     | 170.2    | 19       | 620    | 0   | 2          | 242        | 218         |
| `/rotate-pdf`                                | 147.5     | 171.6    | 19       | 636    | 0   | 2          | 229        | 204         |
| `/split-pdf`                                 | 149.3     | 173.8    | 19       | 608    | 0   | 2          | 229        | 192         |
| `/terms`                                     | 136.6     | 164.1    | 23       | 636    | 0   | 2          | 278        | 235         |
| `/tools`                                     | 144.4     | 172.4    | 20       | 652    | 0   | 2          | 256        | 234         |
| `/word-to-pdf`                               | 141.5     | 166.3    | 18       | 612    | 0   | 2          | 229        | 206         |

### Choosing a file (four-page PDF), slow phone

Script is what the page fetches after the file is chosen; CLS and long tasks
are counted from that moment.

| Page                   | Script KB | CLS   | Long tasks | Longest ms |
| ---------------------- | --------- | ----- | ---------- | ---------- |
| `/split-pdf`           | 495.2     | 0.065 | 3          | 264        |
| `/organize-pdf`        | 495.2     | 0.084 | 2          | 259        |
| `/pdf-to-jpg`          | 495.2     | 0.035 | 3          | 260        |
| `/extract-pdf-pages`   | 495.2     | 0.055 | 2          | 242        |
| `/delete-pdf-pages`    | 495.2     | 0.055 | 2          | 241        |
| `/rotate-pdf`          | 495.2     | 0.084 | 3          | 264        |
| `/pdf-to-text`         | 496.1     | 0.001 | 2          | 251        |
| `/remove-pdf-metadata` | 178.3     | 0     | 2          | 215        |
| `/compress-pdf`        | 0         | 0.005 | 1          | 64         |
| `/merge-pdf`           | 0         | 0.04  | 1          | 60         |

### Layout shift after choosing a file, with and without the height hold

The build test's own run (phone viewport, normal network, four-page PDF,
default font). "Without" is the same build with the workspace's height hold
disabled, which is how the page behaved before M7F.

| Tool            | Without | With  |
| --------------- | ------- | ----- |
| Split           | 0.248   | 0     |
| Organize        | 0.187   | 0.008 |
| PDF to JPG      | 0.255   | 0     |
| Extract pages   | 0.250   | 0     |
| Delete pages    | 0.250   | 0     |
| Rotate          | 0.243   | 0.008 |
| PDF to Text     | 0.073   | 0.002 |
| Remove Metadata | 0.161   | 0     |
| Compress        | 0.006   | 0.006 |
| Merge           | 0.023   | 0.023 |

On the slow phone the same change gives the larger figures in the table above
(at most 0.084), because the intermediate state lasts longer.

## Limits of this evidence

- One run per page, on one development machine, with a throttled desktop
  browser rather than a phone; timing numbers will differ on a real device and
  on a CI runner. The enforced limits leave room for that.
- Layout shift was also measured in a wide font (DejaVu Sans, the CI runner's
  default); the numbers differ a little (Merge 0.086) and stay inside the limit.
- Chromium only for time and shift. Real devices and Safari are the M7G check.
- Per-tool processing time on large documents is in the earlier per-tool
  benchmarks, not here.

Machine-readable evidence is in
[`M7F-performance-results.json`](M7F-performance-results.json). Reproduce after
a production build with:

```text
pnpm --filter @document-platform/web build
node apps/web/benchmarks/run-performance.mjs
```
