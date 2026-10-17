# M3B.3 PDF to Text benchmark

Status: measured. `docs/benchmarks/M3B3-pdf-to-text-results.json` holds a real run of `apps/web/benchmarks/run-pdf-to-text.mjs` against the production server on the Windows development machine (Node 24, Playwright Chromium). Figures are single-run engineering evidence, not performance guarantees.

## Scope and fixtures

The harness is `apps/web/benchmarks/run-pdf-to-text.mjs`. It uses only project-authored synthetic PDFs; no filenames, document contents or extracted text are retained outside the ignored `.tools/pdf-to-text-review/` folder.

- `tests/fixtures/pdf/preview-features.pdf` — the existing shared mixed-font/crop/rotation preview fixture, re-used as a representative text-heavy document.
- `tests/fixtures/pdf/text-xss.pdf` — single page carrying literal `<script>alert(1)</script>`, `<img src=x onerror=…>`, `javascript:` and ampersand/quote payloads as plain text.
- `tests/fixtures/pdf/text-partial.pdf` — three pages: text, blank, text. Used to confirm partial-text behaviour and `pagesWithoutText` reporting.
- `tests/fixtures/pdf/text-scanned.pdf` — one image-only page with no text layer. Used to confirm the honest no-text / OCR panel without a server upload.

The authoring script `tests/fixtures/generate_text_fixtures.py` is deterministic and uses the already-available ReportLab + Pillow authoring utilities (optional local tool, never a product or CI dependency). Fixture SHA-256 values are recorded in `tests/fixtures/pdf/text-manifest.json`.

## Measurements recorded by the harness

Written to `docs/benchmarks/M3B3-pdf-to-text-results.json`:

- `generatedAt`, `node`, `browser` — provenance of the run.
- `cases[].readyMs` — time from navigation and file selection until "Extracted text ready" (or the no-text panel) is visible. It includes page load.
- `cases[].previewCharacters` — DOM preview size (no-text cases record 0).
- `cases[].sameOriginRequests` — every request in the case was a same-origin GET.
- `requestAudit` — totals across all cases: `totalRequests`, `crossOrigin`, `nonGet`, `canaryLeaks` (filename and document-text canaries in any request URL, body or header), `webSockets`, `consoleCanaryLeaks` and `storageEntries` (localStorage + sessionStorage). The runner fails unless every count except `totalRequests` is 0.

Character/byte totals, cancellation timing and worker/Blob-URL peaks are not measured by this harness; they are covered by unit and E2E tests.

## Reproduction

The harness runs after a production build. On the Product Owner's Windows toolchain:

```sh
pnpm --filter @document-platform/web build
node apps/web/benchmarks/run-pdf-to-text.mjs
```

The harness starts its own Chromium against the production server (port 3100 by convention, same as `playwright.config.ts`). Run it with other Playwright/Vitest workloads stopped. The result file `docs/benchmarks/M3B3-pdf-to-text-results.json` is overwritten on each run.

## Measured engineering caps

The caps committed to the registry for `pdf-to-text` are deliberately conservative and documented in ADR-019:

- One PDF, 10 MiB input, 200 pages (inherited from the shared `localPageLimits`).
- 2,000,000 extracted characters.
- 8 MiB UTF-8 bytes.
- 20,000-character DOM preview.

They are evidence-based engineering controls, not public performance guarantees. The physical low-memory mobile verification remains a launch gate, and the caps may be lowered after that verification.

## Known limitations

- Reading-order fidelity for structurally complex PDFs (multi-column journal articles, highly positioned text, artistic layouts) is bounded by what PDF.js's `getTextContent` returns in natural content-stream order. The product UI and ADR-019 disclose this honestly. The partial-text and XSS fixtures are deterministic; comparisons against third-party readers like Poppler `pdftotext` are useful as spot checks but are not treated as a correctness oracle, since `pdftotext` applies its own column-detection heuristics the project deliberately does not replicate.
- The browser Clipboard API can fail (private windows, permissions). The session surfaces a `CLIPBOARD_FAILED` state and keeps the Download path available.
