# M3B.2 PDF to JPG benchmark

Measured on 10 October 2026 with the project-pinned Playwright Chromium against the production build. The harness uses only project-authored synthetic PDFs and records no source filename or document data. Raw timings are in `M3B2-pdf-to-jpg-results.json`; independent raster comparison is in `M3B2-reference-comparison.json`. Ignored JPGs and ZIPs are written under `.tools/pdf-to-jpg-review/`.

| Workload                        | Pages | DPI | Preview ready | Output ready | ZIP/output | Combined JPG | Peak workers | Peak Blob URLs |
| ------------------------------- | ----: | --: | ------------: | -----------: | ---------: | -----------: | -----------: | -------------: |
| Mixed crop/orientation fixture  |     4 | 150 |      5,046 ms |     4,210 ms |  174,606 B |    174,184 B |            1 |              1 |
| Rotated crop-box page           |     1 | 300 |      4,872 ms |     5,752 ms |   88,362 B |     88,362 B |            1 |              1 |
| Fifty blank Letter pages at cap |    50 |  96 |      4,439 ms |     8,896 ms |  295,372 B |    290,350 B |            1 |              1 |

Every scenario produced the exact expected page count, dimensions and effective orientation with no cross-origin/non-GET request or page error. Reset returned live worker and Blob URL counts to zero. The 300 DPI representative page remained below the 25 MP / 100 MB per-page caps. The 50-page case remained below the 220 MP aggregate cap.

Poppler `pdftoppm` independently rendered the same crop boxes at the same effective dimensions. Across four 150 DPI pages and the rotated page at 300 DPI, normalized mean pixel differences were 0.34%–0.61%. These small differences include independent antialiasing and JPEG encoding. Poppler emitted missing-display-font diagnostics for unused fixture font names, but geometry and visible fixture content remained comparable.

These are local engineering measurements, not public performance promises. Browser engine, hardware, thermal state and document complexity affect time and compressed size. Physical low-memory mobile testing remains a launch gate.
