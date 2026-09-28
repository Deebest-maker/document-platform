# Third-party notices

Retain upstream notices when packaging the application. Dependency metadata is reviewed in [docs/dependency-review.md](docs/dependency-review.md); this file highlights the separately distributed preview assets.

## Liberation Sans 2.1.5 — SIL Open Font License 1.1

Digitized data copyright (c) 2010 Google Corporation, with Reserved Font Arimo, Tinos and Cousine. Copyright (c) 2012 Red Hat, Inc., with Reserved Font Name Liberation.

The four unmodified Regular, Bold, Italic and BoldItalic fonts are licensed under SIL OFL 1.1. The **complete original license and copyright notice** are retained in [LICENSE](packages/pdf-browser/assets/liberation-sans/2.1.5/LICENSE), copied verbatim into the application at `/vendor/pdfjs/6.3.289/standard_fonts/LICENSE_LIBERATION_OFL`. [Provenance](packages/pdf-browser/assets/liberation-sans/2.1.5/provenance.json) identifies the official release, metadata and exact hashes. The fonts are not renamed or modified. PDF.js's older bundled GPL Liberation fonts are not distributed.

## PDF.js 6.3.289 and permitted assets

The Apache-2.0 runtime notice is served at `/vendor/pdfjs/6.3.289/LICENSE`. The prepared assets retain these original notices:

| Assets                      | License / notice paths under the versioned asset directory                  |
| --------------------------- | --------------------------------------------------------------------------- |
| Adobe CMaps                 | Adobe BSD-style; `cmaps/LICENSE`                                            |
| PDFium/Foxit standard fonts | BSD-3-Clause; `standard_fonts/LICENSE_FOXIT`                                |
| JBIG2 decoder               | BSD-3-Clause / Apache-2.0; `wasm/LICENSE_JBIG2`, `wasm/LICENSE_PDFJS_JBIG2` |
| OpenJPEG decoder            | BSD-2-Clause; `wasm/LICENSE_OPENJPEG`, `wasm/LICENSE_PDFJS_OPENJPEG`        |
| qcms color conversion       | MIT; `wasm/LICENSE_QCMS`, `wasm/LICENSE_PDFJS_QCMS`                         |
| Compact ICC profile         | CC0-1.0; `iccs/LICENSE`                                                     |

QuickJS, sandbox/viewer, legacy bundles, source maps and non-allowlisted assets are excluded. Build-time asset verification checks the complete served inventory and hashes. The installed development dependency may contain excluded upstream files; never deploy the dependency directory as public static content.

The synthetic embedded Noto Sans test control has a separate [OFL notice](tests/fixtures/licenses/OFL-NotoSans.txt) and is not a PDF.js replacement asset.
