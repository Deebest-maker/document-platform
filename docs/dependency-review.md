# Dependency review

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
