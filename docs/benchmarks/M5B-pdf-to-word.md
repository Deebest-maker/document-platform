# M5B PDF to Word fidelity benchmark: results

**Decision: DEFER**

Gates are those fixed in [M5B-pdf-to-word-criteria.md](M5B-pdf-to-word-criteria.md) before any measurement. Raw conversions: [M5B-pdf-to-word-results.json](M5B-pdf-to-word-results.json); scoring detail: [M5B-pdf-to-word-evaluation.json](M5B-pdf-to-word-evaluation.json). Environment: LibreOffice 24.2.7.2 420(Build:2), Python 3.13.16, 2 vCPU shared VM, synthetic corpus.

## libreoffice

| Gate                | Result   | Measured                                                                                |
| ------------------- | -------- | --------------------------------------------------------------------------------------- |
| G1 text integrity   | pass     | worst A recall 100.0% (A01), worst A precision 99.4% (A02), worst B recall 100.0% (B01) |
| G2 reading order    | **FAIL** | worst A order 95.5% (A05), worst B order 36.6% (B02)                                    |
| G3 editability      | **FAIL** | lowest A flow share 0.0% (A01), highest prose fragmentation 0.0                         |
| G4 tables           | **FAIL** | 0/3 tables with >=90% cells correct                                                     |
| G5 images           | pass     | A06 3 of 3                                                                              |
| G6 visual           | **FAIL** | median SSIM 0.579; pages A01 3->3, A02 2->2, A03 3->3, A04 1->1, A05 3->3, A06 2->2     |
| G7 scanned          | pass     | C01 hidden-word leak 0.0%, output words 0                                               |
| G8 operational      | **FAIL** | D05-corrupt not a clean failure; peak 615 MiB                                           |
| G9 validity         | pass     |                                                                                         |
| G10 licence/offline | pass     |                                                                                         |

| File                     | Recall | Precision | Order  | Flow share | Fragmentation | Tables ok | Images | Pages    | Median SSIM | Wall   | Peak RSS |
| ------------------------ | ------ | --------- | ------ | ---------- | ------------- | --------- | ------ | -------- | ----------- | ------ | -------- |
| A01-prose-headings       | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 0      | 3->3     | 0.55        | 1.7 s  | 220 MiB  |
| A02-emphasis-lists       | 100.0% | 99.4%     | 99.7%  | 0.0%       | 0.0           | -         | 0      | 2->2     | 0.58        | 1.7 s  | 212 MiB  |
| A03-report-furniture     | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 0      | 3->3     | 0.44        | 1.7 s  | 221 MiB  |
| A04-invoice-table        | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | 0/2       | 0      | 1->1     | 0.60        | 1.7 s  | 221 MiB  |
| A05-data-table           | 100.0% | 100.0%    | 95.5%  | 0.0%       | 0.0           | 0/1       | 0      | 3->3     | 0.44        | 3.0 s  | 222 MiB  |
| A06-images-captions      | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 3/3    | 2->2     | 0.75        | 1.5 s  | 221 MiB  |
| B01-two-column           | 100.0% | 100.0%    | 53.6%  | 0.0%       | 0.0           | -         | 0      | 2->2     | 0.70        | 1.6 s  | 186 MiB  |
| B02-three-column-sidebar | 100.0% | 100.0%    | 36.6%  | 0.0%       | 0.0           | -         | 0      | 2->2     | 0.68        | 1.8 s  | 221 MiB  |
| B03-slides               | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 0      | 4->4     | 0.81        | 1.5 s  | 216 MiB  |
| B04-form                 | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 0      | 1->1     | 0.82        | 1.5 s  | 194 MiB  |
| B05-image-wrap           | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 1/1    | 1->1     | 0.51        | 1.5 s  | 221 MiB  |
| B06-arabic-rtl           | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 0      | 1->1     | 0.59        | 1.5 s  | 221 MiB  |
| C01-scanned              | n/a    | n/a       | n/a    | n/a        | n/a           | -         | 2      | 2->2     | -           | 2.5 s  | 234 MiB  |
| C02-scanned-ocr-layer    | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 2      | 2->2     | -           | 3.0 s  | 234 MiB  |
| D01-50-pages             | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 0      | 50->50   | -           | 6.5 s  | 315 MiB  |
| D02-200-pages            | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 0      | 198->198 | -           | 61.8 s | 615 MiB  |
| D03-near-20MiB           | 100.0% | 100.0%    | 100.0% | 0.0%       | 0.0           | -         | 8/8    | 8->8     | -           | 6.7 s  | 268 MiB  |
| D04-encrypted            | n/a    | n/a       | n/a    | n/a        | n/a           | -         | -      | -        | -           | 1.7 s  | 197 MiB  |
| D05-corrupt              | n/a    | 0.0%      | n/a    | 0.0%       | n/a           | -         | 0      | -        | -           | 1.6 s  | 211 MiB  |

## prototype

| Gate                | Result   | Measured                                                                                 |
| ------------------- | -------- | ---------------------------------------------------------------------------------------- |
| G1 text integrity   | pass     | worst A recall 100.0% (A01), worst A precision 100.0% (A01), worst B recall 100.0% (B01) |
| G2 reading order    | pass     | worst A order 100.0% (A01), worst B order 97.9% (B01)                                    |
| G3 editability      | pass     | lowest A flow share 100.0% (A01), highest prose fragmentation 1.28                       |
| G4 tables           | pass     | 3/3 tables with >=90% cells correct                                                      |
| G5 images           | pass     | A06 3 of 3                                                                               |
| G6 visual           | **FAIL** | median SSIM 0.574; pages A01 3->3, A02 2->2, A03 3->4, A04 1->1, A05 3->4, A06 2->3      |
| G7 scanned          | pass     | C01 hidden-word leak 0.0%, output words 0                                                |
| G8 operational      | pass     | peak 142 MiB                                                                             |
| G9 validity         | pass     |                                                                                          |
| G10 licence/offline | pass     |                                                                                          |

| File                     | Recall | Precision | Order  | Flow share | Fragmentation | Tables ok | Images | Pages    | Median SSIM | Wall   | Peak RSS |
| ------------------------ | ------ | --------- | ------ | ---------- | ------------- | --------- | ------ | -------- | ----------- | ------ | -------- |
| A01-prose-headings       | 100.0% | 100.0%    | 100.0% | 100.0%     | 0.76          | -         | 0      | 3->3     | 0.45        | 0.7 s  | 61 MiB   |
| A02-emphasis-lists       | 100.0% | 100.0%    | 100.0% | 100.0%     | 0.76          | -         | 0      | 2->2     | 0.58        | 1.3 s  | 62 MiB   |
| A03-report-furniture     | 100.0% | 100.0%    | 100.0% | 100.0%     | 1.28          | -         | 0      | 3->4     | 0.49        | 1.3 s  | 63 MiB   |
| A04-invoice-table        | 100.0% | 100.0%    | 100.0% | 100.0%     | 1.0           | 2/2       | 0      | 1->1     | 0.66        | 0.7 s  | 58 MiB   |
| A05-data-table           | 100.0% | 100.0%    | 100.0% | 100.0%     | 1.0           | 1/1       | 0      | 3->4     | 0.39        | 1.0 s  | 63 MiB   |
| A06-images-captions      | 100.0% | 100.0%    | 100.0% | 100.0%     | 1.0           | -         | 3/3    | 2->3     | 0.78        | 0.9 s  | 83 MiB   |
| B01-two-column           | 100.0% | 100.0%    | 97.9%  | 100.0%     | 1.1           | -         | 0      | 2->3     | 0.68        | 0.6 s  | 63 MiB   |
| B02-three-column-sidebar | 100.0% | 100.0%    | 100.0% | 100.0%     | 1.42          | -         | 0      | 2->2     | 0.65        | 0.7 s  | 61 MiB   |
| B03-slides               | 100.0% | 100.0%    | 100.0% | 100.0%     | 1.0           | -         | 0      | 4->4     | 0.85        | 0.4 s  | 56 MiB   |
| B04-form                 | 100.0% | 100.0%    | 100.0% | 100.0%     | 0.61          | -         | 0      | 1->1     | 0.86        | 0.4 s  | 56 MiB   |
| B05-image-wrap           | 100.0% | 100.0%    | 100.0% | 100.0%     | 1.0           | -         | 1/1    | 1->1     | 0.43        | 0.7 s  | 76 MiB   |
| B06-arabic-rtl           | 100.0% | 100.0%    | 100.0% | 100.0%     | 1.0           | -         | 0      | 1->1     | 0.65        | 0.9 s  | 60 MiB   |
| C01-scanned              | n/a    | n/a       | n/a    | n/a        | n/a           | -         | 2      | 2->2     | -           | 0.9 s  | 84 MiB   |
| C02-scanned-ocr-layer    | 100.0% | 100.0%    | 100.0% | 100.0%     | 0.03          | -         | 2      | 2->4     | -           | 1.1 s  | 95 MiB   |
| D01-50-pages             | 100.0% | 100.0%    | 100.0% | 100.0%     | 0.89          | -         | 0      | 50->69   | -           | 6.7 s  | 75 MiB   |
| D02-200-pages            | 100.0% | 100.0%    | 100.0% | 100.0%     | 0.9           | -         | 0      | 198->280 | -           | 24.3 s | 114 MiB  |
| D03-near-20MiB           | 100.0% | 100.0%    | 100.0% | 100.0%     | 1.0           | -         | 8/8    | 8->8     | -           | 2.6 s  | 142 MiB  |
| D04-encrypted            | n/a    | n/a       | n/a    | n/a        | n/a           | -         | -      | -        | -           | 0.3 s  | 48 MiB   |
| D05-corrupt              | n/a    | n/a       | n/a    | n/a        | n/a           | -         | -      | -        | -           | 0.3 s  | 48 MiB   |

## What the visual gate (G6) measures

SSIM of each Class A page against the same page moved by a few pixels (1 px = 1 pt = 0.35 mm at 72 dpi):

| Shift | Median SSIM |
| ----- | ----------- |
| 0 px  | 1.000       |
| 1 px  | 0.698       |
| 2 px  | 0.638       |

A one-point shift already scores below the 0.70 threshold, so G6 as written demands sub-point positional agreement on every page. The two candidates score alike (see the tables above) although LibreOffice places every line at an absolute position and the prototype reflows text, which suggests the metric is dominated by small offsets and glyph rasterisation rather than layout quality. G6 is reported as pre-registered and decides the outcome by rule; the calibration is a measurement-design finding, not evidence of poor fidelity. See ADR-027.

## Sensitivity (not the decision rule)

| Candidate   | Failed gates       | Failed gates if G6 were set aside |
| ----------- | ------------------ | --------------------------------- |
| libreoffice | G2, G3, G4, G6, G8 | G2, G3, G4, G8                    |
| prototype   | G6                 | none                              |
