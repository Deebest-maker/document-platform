# M3B.4 Remove PDF Metadata — synthetic benchmark

**Status:** measured. `M3B4-remove-pdf-metadata-results.json` holds a real run of `apps/web/benchmarks/run-remove-pdf-metadata.mjs` against the production server (Node 24, Playwright Chromium, Windows). Single-run engineering evidence only.

## Purpose

The benchmark exercises the local Remove PDF Metadata flow end to end against two project-authored synthetic fixtures and records:

- The time to open the page and prepare the engine.
- The time to run `reading → removing → validating → verifying` for a metadata-rich input and for a no-metadata input.
- Whether the published download link is a `blob:` URL (local) rather than a server endpoint.
- Whether the UI's "trailer identifier could not be suppressed" note appeared — i.e. the real trailer-/ID SPIKE outcome for this build and this fixture.
- A privacy audit of every network request the page made, counting (a) cross-origin requests, (b) non-`GET` requests, and (c) requests whose body contained any of the fixture canaries (`SECRET-TITLE-CANARY-9Hjk`, `SECRET-AUTHOR-CANARY-2Fqz`, `ACME-INTERNAL-CANARY-X3b`, `XMP-CANARY-V7m`).

The runner asserts the privacy-audit counts are zero after writing the results file; a non-zero value fails the run.

## Fixtures

- `tests/fixtures/pdf/metadata-rich.pdf` — three pages (one rotated 90°), every supported Info field, two custom Info keys, an XMP metadata stream, and no trailer `/ID` (pdf-lib does not write one). Generator: `tests/fixtures/scripts/generate-metadata-rich.mjs`. Manifest: `tests/fixtures/pdf/METADATA-RICH-MANIFEST.md`.
- A one-page synthetic PDF the runner generates in-memory with no Info dictionary, XMP or trailer `/ID`.

## What the result file records

See `M3B4-remove-pdf-metadata-results.json` for the full shape. Besides the fields below, each scenario records `standardInfoBeforeAfter`, `customInfoBeforeAfter`, `xmpBeforeAfter`, `trailerIdPresentBeforeAfter` (read from the on-page table) and `downloadFilename` (must be `metadata-removed.pdf`). `requestAudit` additionally records `totalRequests`, `webSockets`, `consoleCanaryLeaks` and `storageEntries`; all except `totalRequests` must be 0. The source filename sent to the page is itself a canary.

**Trailer `/ID` SPIKE finding:** neither benchmark fixture carries a trailer `/ID` (before and after are both "absent"), so this run shows no suppression failure but also does not demonstrate `/ID` removal. A PDF with a real `/ID` is needed to exercise the spike.

| Field                                                   | Meaning                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `generatedAt`                                           | ISO timestamp of the real run that produced this file.                                    |
| `node`                                                  | Node.js version string that drove the run.                                                |
| `browser`                                               | Browser label (`chromium (Playwright)`).                                                  |
| `scenarios.metadata-rich.openMs`                        | Milliseconds to open `/remove-pdf-metadata` and render the picker.                        |
| `scenarios.metadata-rich.processMs`                     | Milliseconds from file selection to the "Cleaned PDF ready" heading becoming visible.     |
| `scenarios.metadata-rich.downloadIsBlob`                | `true` only when the published download `href` is a `blob:` URL.                          |
| `scenarios.metadata-rich.trailerIdControllableReported` | `true` when the UI did NOT display the "trailer identifier could not be suppressed" note. |
| `scenarios.no-metadata.*`                               | The same measurements for a one-page PDF with no supported metadata.                      |
| `requestAudit.crossOrigin`                              | Count of requests whose URL did not stay same-origin or `blob:`. Non-zero fails the run.  |
| `requestAudit.nonGet`                                   | Count of non-`GET`/non-`HEAD` requests observed.                                          |
| `requestAudit.canaryLeaks`                              | Count of request bodies that contained a fixture canary. Non-zero fails the run.          |

## Running it

```sh
pnpm --filter @document-platform/web benchmark:remove-pdf-metadata
```

(Or `node apps/web/benchmarks/run-remove-pdf-metadata.mjs` from the repo root.) The runner needs a prior `pnpm build` (it uses `next start`), a free TCP port in the 3100–3199 range and the project's Playwright browsers.
