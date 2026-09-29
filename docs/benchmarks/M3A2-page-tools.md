# M3A.2 Extract, Delete and Rotate product benchmark

Date: 2026-09-29

## Scope

This focused synthetic benchmark exercises the real `/extract-pdf-pages`,
`/delete-pdf-pages` and `/rotate-pdf` product routes. It measures only the
selection and rotation work introduced by M3A.2 and retains the M2B renderer
settings. It is not a public performance guarantee.

The fixture repeats the project-authored mixed geometry, crop, rotation and font
pages to the documented 200-page engineering limit. Each route runs at desktop
and mobile Chromium viewports. Every case performs Select all followed by Clear
selection. Rotate additionally applies one selected-page quarter turn.

## Result

- All six cases loaded 200 stable page records without horizontal overflow.
- The first visible preview became ready in approximately 0.6–1.9 seconds on
  this development machine.
- Select all plus Clear selection completed in 137–318 milliseconds.
- Already rendered thumbnails recorded **zero additional canvas renders**
  during selection or delete-state changes.
- Rotate recorded one new render for the affected visible thumbnail and zero
  for other already rendered thumbnails.
- The unchanged scheduler has one active render and retains at most eight queue
  entries, enforced by the existing scheduler unit suite.
- All observed requests were first-party GET requests with no request body.

The selected 200-page engineering limit remains suitable for M3A.2. Mobile rows
use browser emulation and are not physical-device measurements.

Machine-readable evidence is in
[`M3A2-page-tools-results.json`](M3A2-page-tools-results.json). Reproduce after a
production build with:

```text
node apps/web/benchmarks/run-page-tools.mjs
```
