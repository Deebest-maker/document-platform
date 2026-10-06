# Dependency review

## M3A.2 post-acceptance CI security closeout

Reviewed on 6 October 2026 after GitHub Advisory Database update GHSA-68fv-2mgg-jv7q caused the required audit to reject the previously locked `source-map-js@1.2.1`. The advisory affects versions from 1.0.0 through 1.2.1 and identifies 1.2.2 as patched. The workspace override now resolves every Next/PostCSS, Tailwind and test-tooling path to exact `source-map-js@1.2.2` (BSD-3-Clause, no dependencies, npm integrity `sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==`). This is a same-line transitive security update and adds no product capability or infrastructure.

The preceding closeout also retained the reviewed local `braces@3.0.4-document-platform.0` lint-tool patch for GHSA-vfj7-8cjw-p6xm because no upstream patched version exists. Its MIT source provenance, integrity, preserved license and bounded nesting change are recorded in `vendor/braces/SECURITY-PATCH.md`; `scripts/test-braces-security.mjs` covers the security behavior. Neither package is a document-processing engine, and no AGPL or unknown license is introduced.

## M3A.2 Extract, Delete and Rotate PDF pages

Reviewed on 29 September 2026. M3A.2 adds no production or development dependency and does not change the lockfile. The three local product routes reuse the reviewed `pdfjs-dist@6.3.289` preview assets and `pdf-lib@1.17.1` structural worker from M2B/M2A. No range/archive package, drag library, second PDF engine, server document engine, AGPL package, persistence or analytics integration is introduced. Existing notices, PDF.js asset verification and locked JavaScript/Python audits remain applicable.

## M3A.1 Organize PDF

Reviewed on 29 September 2026. M3A.1 adds no production or development dependency and does not change the lockfile. The product route reuses the reviewed `pdfjs-dist@6.3.289` preview assets and `pdf-lib@1.17.1` structural worker from M2B/M2A. No drag library, archive library, server document engine, AGPL package or analytics integration is introduced. Existing notices, asset verification and locked audits remain applicable.

## M2B PDF.js and the approved OFL font alternative

Reviewed on 27 September 2026. `pdfjs-dist@6.3.289` is pinned; its runtime is Apache-2.0 and is imported lazily by the preview entry point. The package-specific override `pdfjs-dist@6.3.289>@napi-rs/canvas: "-"` excludes only its unused optional Node canvas dependency. Existing versions and the workspace install-script allowlist are unchanged.

Package metadata alone does not describe all bundled asset licenses. The explicit experiment subset includes Adobe CMaps, PDFium/Foxit standard fonts, JBIG2/OpenJPEG/qcms codecs and an ICC profile, with their notices. The four bundled LiberationSans TTFs and `LICENSE_LIBERATION` remain excluded from served assets: their GPLv2 terms with font exceptions require an owner decision. QuickJS, viewer/sandbox, legacy bundles and all other non-allowlisted files are also excluded. The installed package still contains its original vendor files; exclusion concerns served/distributed application assets, not rewriting the installed package.

The [initial inventory](benchmarks/M2B-font-assets.json) and [initial gate report](reports/M2B-font-license-gate.md) retain the failed Helvetica clipping evidence. Following explicit owner authorization, **unmodified Liberation Sans 2.1.5 from the official release** passed the [alternative compatibility gate](benchmarks/M2B-ofl-fonts.md). Only Regular, Bold, Italic and BoldItalic plus the original SIL OFL 1.1 notice are supplied separately. Exact upstream/archive/file hashes, metadata and copyright notices are retained in `packages/pdf-browser/assets/liberation-sans/2.1.5/`. This does not authorize redistribution of the bundled GPL version. [ADR-013](adr/013-m2b-page-foundation.md) records the deliberate substitution and supported glyph-path rendering configuration.

The build prepares 198 reviewed asset files plus the PDF.js root license and generated manifest. `scripts/check-pdfjs-assets.mjs` verifies every hash, exact output inventory, four OFL font hashes and notices, and byte inequality with the bundled GPL fonts. No CDN or system font dependency is used. Generated public assets are ignored; installation/build reproduces them from locked dependencies and the four reviewed vendored files. Font/CMap/codec assets load only when needed by a local preview. The synthetic fixtures embed a pinned OFL-1.1 Noto Sans subset with its notice; this remains a fixture control. Poppler, ReportLab and pypdf are verification/fixture-authoring tools, not product dependencies.

## M2A Merge PDF

Reviewed on 25 September 2026 against the installed graph, lockfile, published package metadata and license inventory. The only new runtime engine is **pdf-lib 1.17.1 (MIT)**, isolated behind `packages/pdf-browser`. Its newly resolved dependencies are `@pdf-lib/standard-fonts@1.0.0` (MIT), `@pdf-lib/upng@1.0.1` (MIT), `pako@1.0.11` (MIT AND Zlib), and `tslib@1.14.1` (0BSD). The existing tslib 2.8.1 remains used elsewhere. Retain all bundled notices. No PDF.js or AGPL dependency is added.

The Windows license inventory has 407 package-name records (some contain multiple resolved versions), versus 403 in M1. The lockfile adds five package resolutions and workspace wiring; existing external versions are unchanged. `pnpm audit --audit-level=high` found no known vulnerabilities. The unchanged Python graph passed `uv audit --locked`, with no known vulnerabilities or adverse statuses in 28 packages. Audits are point-in-time dependency checks, not proof that untrusted PDFs are safe.

Review implementation details against the installed pdf-lib sources. Its ES5 `EncryptedPDFError` loses its prototype in this runtime; safe mapping matches the library's fixed message as well as its class. Its parser can emit document-derived diagnostics; production execution is confined to a dedicated worker whose console methods discard those diagnostics. No raw parser cause is exposed. Encryption bypass is disabled, invalid objects fail strict parsing, and the output is reopened and counted before a Blob is returned.

Optional fixture authoring uses the already available local ReportLab 4.4.9 (BSD), pypdf 6.10.0 (BSD-3-Clause), cryptography 50.0.1 (Apache-2.0 OR BSD-3-Clause), and Pillow 12.3.0 (MIT-CMU) for the ignored benchmark image corpus. These tools are not installed into the application, processor or CI. Synthetic fixture provenance and hashes are in `tests/fixtures/pdf/manifest.json`; the self-signed fixture key is generated in memory and never retained. Poppler and external PDF readers are verification tools only.

Reproduce with `pnpm view pdf-lib@1.17.1 version license dependencies --json`, `pnpm licenses list --json`, the five installed manifests, and both locked audits. Required CI names and existing security checks remain unchanged.

## M1 product shell

Reviewed on 24 September 2026. The sole new third-party package is the development-only `@axe-core/playwright@4.13.0` adapter, published and installed under MPL-2.0. Its `axe-core@4.13.0` dependency was already locked in M0, and it reuses Playwright Core 1.63.0. No existing external dependency versions changed. Retain the bundled license notices; the adapter is not part of the production application bundle.

The registry is a private, dependency-free workspace package. UI adds a registry workspace reference, React peer declaration, and the already-used React types version; web references the registry. These are local package wiring changes, not new application frameworks.

The installed Windows inventory now contains 403 JavaScript package records. The license categories are unchanged from M0; no AGPL or unknown categories appeared. `pnpm audit --audit-level=high` found no known vulnerabilities. The unchanged locked Python environment passed `uv audit --locked` with no known vulnerabilities or adverse statuses in 28 packages.

Verify with `pnpm view @axe-core/playwright@4.13.0 version license dependencies --json`, the installed package manifest, `pnpm licenses list --json`, and the locked dependency audits. The adapter supplies automated accessibility rules beyond Playwright interaction assertions. Keyboard, reflow and manual visual review remain required; axe does not establish full WCAG conformance.

## M0 foundation

Reviewed on 24 September 2026 against `pnpm-lock.yaml`, `services/processor/uv.lock`, installed package metadata, and the architecture's licensing rules. This records the M0 dependency selection; future dependency changes require another review.

| Area              | Selected tools                                                         | Declared licenses |
| ----------------- | ---------------------------------------------------------------------- | ----------------- |
| Web runtime       | Next.js 16.3.6, React/React DOM 19.3.0, cross-env 10.1.0               | MIT               |
| Styling           | Tailwind CSS/PostCSS integration 4.3.3, PostCSS 8.5.28                 | MIT               |
| Type checking     | TypeScript 5.9.3                                                       | Apache-2.0        |
| Web quality       | ESLint 9.39.5, Next ESLint config 16.3.6, Prettier 3.9.9, Vitest 5.0.1 | MIT               |
| Browser checks    | Playwright 1.63.0                                                      | Apache-2.0        |
| Processor runtime | FastAPI 0.141.1, Pydantic 2.13.5; Uvicorn 0.53.0                       | MIT; BSD-3-Clause |
| Python quality    | Ruff 0.16.8, mypy 1.20.2, pytest 9.1.1; HTTPX2 2.13.1                  | MIT; BSD-3-Clause |

The installed Windows inventory contained 402 JavaScript package records and 27 Python distributions. No AGPL license identifiers or unknown license categories appeared. JavaScript inventory categories were MIT, MIT-0, Apache-2.0, Apache-2.0 AND LGPL-3.0-or-later, Python-2.0, MPL-2.0, CC-BY-4.0, BSD-2-Clause, ISC, BSD-3-Clause, CC0-1.0, BlueOak-1.0.0, and 0BSD. Python inventory additionally included PSF-2.0 and dual Apache/BSD terms. Counts vary by operating system because native optional packages differ.

Retain the notices shipped with dependencies and containers. In particular, Next.js's optional Sharp binary includes LGPL terms; Lightning CSS, axe-core, and Python's development dependency pathspec include MPL terms. None is an AGPL document engine. PyMuPDF, Ghostscript, PDF libraries, and Office conversion engines are not part of M0.

ESLint remains on the deprecated 9.x line because the installed Next.js React/import plugins declare support through ESLint 9. TypeScript 5.9 is within the installed TypeScript ESLint parser's supported range. The dependency audit found no known vulnerabilities; reevaluate this compatibility constraint when the lint plugins support ESLint 10. Do not force incompatible peers or suppress lint checks.

Reproduce the metadata review with `pnpm licenses list --json` and `importlib.metadata` inside the processor's locked environment. Run `pnpm audit --audit-level=high` and `uv audit --locked --project services/processor` for current vulnerability results. The pinned uv release exposes its audit command as experimental; its results and exit status remain part of the M0 CI check.
