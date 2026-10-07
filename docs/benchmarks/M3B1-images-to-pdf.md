# M3B.1 Images to PDF benchmark

Measured on 7 October 2026 with the project-pinned Playwright Chromium against the production build. The harness creates synthetic images in the browser and records no user filenames or document data. Raw results are in `M3B1-images-to-pdf-results.json`; ignored PDFs and screenshots are written under `.tools/images-to-pdf-review/`.

| Workload                                          | Images | Aggregate pixels | Previews ready | PDF ready |    Output | Peak live Blob URLs |
| ------------------------------------------------- | -----: | ---------------: | -------------: | --------: | --------: | ------------------: |
| Six phone-size JPEGs                              |      6 |       73,156,608 |       1,066 ms |    920 ms | 438,674 B |                   7 |
| Mixed portrait/landscape JPEG and transparent PNG |      4 |       23,394,304 |         480 ms |  1,923 ms | 155,875 B |                   5 |
| Single 6000×4000 JPEG at the 24 MP boundary       |      1 |       24,000,000 |         406 ms |    233 ms | 145,663 B |                   2 |
| EXIF orientation 6 JPEG                           |      1 |        2,400,000 |         226 ms |    246 ms |  17,410 B |                   2 |
| Twenty 1200×900 JPEGs at the count boundary       |     20 |       21,600,000 |         541 ms |    276 ms | 163,578 B |                  21 |

Every scenario completed without horizontal overflow, cross-origin/non-GET requests, page errors, retained workers or retained Blob URLs after reset. Cancelling the 20-image boundary run returned to a reusable ready state and terminated the worker in 112 ms. The browser exposed `performance.memory`, but its sampled before/after delta was zero and is not treated as a reliable peak-memory measurement. Resource safety therefore relies on decoded-pixel estimates, sequential preview/generation, explicit bitmap closure, worker termination and the registry caps rather than this coarse heap sample.

Poppler independently reopened all five representative outputs. It reported the expected 6, 4, 1, 1 and 20 pages, no encryption, no forms, no JavaScript and PDF 1.7. Rendering the transparent-PNG page with `pdftoppm` confirmed the colored center remained visible and transparent regions appeared white. The EXIF orientation-6 output rendered as a 1500×900-point landscape page with its original upper-left marker rotated to the upper right. Browser tests separately verify exact reordered page geometry and Auto/A4/Letter dimensions.

## Limit decision

The measured desktop browser handled the approved boundary workloads. M3B.1 retains the conservative caps in ADR-017: 20 images, 10 MiB per image, 32 MiB compressed total, 8192 pixels per side, 24 MP/96 MiB estimated RGBA per image, 160 MP/640 MiB aggregate decoded estimate and 64 MiB output. The 160 MP aggregate cap is higher than the measured phone workload and remains guarded by sequential processing; physical low-memory mobile validation is still required before launch and may justify lowering it.
