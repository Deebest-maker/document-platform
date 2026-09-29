# M3A.1 Organize PDF product benchmark

Date: 2026-09-29

## Scope

This is a synthetic local engineering benchmark for the real `/organize-pdf`
product route. It reuses the M2B renderer settings and measures the additional
product work introduced by Organize. It is not a public performance guarantee.

The fixture repeats the project-authored mixed geometry, crop, rotation and font
pages to create 10, 50, 100 and 200-page PDFs. Each case runs at desktop and
mobile Chromium viewports. The interaction workload moves source page 1 later
and earlier twelve times, for 24 stable-ID moves.

## Result

- All eight cases loaded the full page model without horizontal overflow.
- The first visible preview and product grid became ready in approximately
  0.7–3.3 seconds on this development machine.
- Twenty-four reorder moves completed in approximately 1.1–5.3 seconds. Seven
  of the eight cases completed in 1.1–1.6 seconds; the desktop 100-page sample
  was the single 5.3-second outlier in this run.
- Pages that had already rendered recorded **zero additional canvas renders**
  during reordering. Newly visible pages may still render normally.
- Reset removed the product canvases in every case.
- All observed requests were first-party GET requests with no request body.

The selected 200-page engineering limit remains suitable for M3A.1. Device
coverage and public launch limits remain subject to later hardening.

Machine-readable evidence is in
[`M3A1-organize-results.json`](M3A1-organize-results.json). Reproduce after a
production build with:

```text
node apps/web/benchmarks/run-organize.mjs
```
