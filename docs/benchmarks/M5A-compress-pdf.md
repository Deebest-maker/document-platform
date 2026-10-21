# M5A Compress PDF: Production Benchmark

Measured on 2026-10-21 against the **production build** of `/compress-pdf` (file chooser → strength → Compress → download), so every number includes the worker, the browser image codec and the verification pass. Inputs are synthetic (`tests/fixtures/generate_compress_benchmark.py`) plus the committed synthetic fixtures; no user data and no filenames beyond synthetic ids are recorded. Raw results: `M5A-compress-pdf-results.json`; independent checks: `M5A-compress-pdf-evaluation.json`.

**Environment:** Intel(R) Xeon(R) Processor @ 2.10GHz x2, 8 GiB RAM, Chromium 141.0.7390.37 (headless), Node v22.22.0, linux 6.18.44-fc-v139. Single cold run per case (three repeats for two cases). This is desktop Chromium on a shared cloud VM: **not a public performance or memory guarantee, and not a phone**. Peak memory is the summed high-water RSS of all renderer processes (page + worker) sampled every 100 ms.

## How the outputs were checked

Every produced PDF was checked with tools that are not part of the product: `qpdf --check` (structure), pdfium (render) with scikit-image SSIM at 100 and 200 dpi on the first, middle and last page plus up to five pages that contain images, and an extracted-text comparison on the same pages. SSIM compares the compressed render to the original render of the same page (1.0 = identical).

- **46 of 46** compressed outputs pass `qpdf --check`; 0 fail.
- **Text identical** on every sampled page of every output (0 mismatches); page counts equal.
- Privacy audit over all runs: 342 requests, 0 cross-origin, 0 non-GET, 0 WebSockets, 0 console errors, 0 page errors.

## Size reduction by profile

Saved % is measured on the downloaded file against the input file. "no file" means the tool correctly reported that it could not make the PDF meaningfully smaller and created no download. SSIM is the worst sampled page at 100 dpi (Light / Balanced / Strong).

| Case                                                       | Input (MB) |   Light | Balanced |  Strong | SSIM (L / B / S)         |
| ---------------------------------------------------------- | ---------: | ------: | -------: | ------: | ------------------------ |
| A01 40-page text, raw (unoptimized producer) streams       |       0.17 |   65.5% |    65.5% |   65.5% | 1.0 / 1.0 / 1.0          |
| A02 Same text, already Flate + object streams              |       0.06 | no file |  no file | no file | – / – / –                |
| A03 Text with a full TrueType font embedded raw            |       0.58 |   52.8% |    52.8% |   52.8% | 1.0 / 1.0 / 1.0          |
| B01 Office report, 5 photos 3000×2000 JPEG q90 at ~545 dpi |       8.51 |   88.8% |    96.0% |   98.3% | 0.9972 / 0.9901 / 0.977  |
| B02 4 camera photos 12 MP JPEG q92 at ~480 dpi             |      14.94 |   89.7% |    96.3% |   98.5% | 0.9938 / 0.9789 / 0.954  |
| C01 8 colour scans, 300 dpi JPEG q85                       |      11.73 |   51.7% |    85.4% |   92.0% | 0.9861 / 0.956 / 0.9392  |
| C02 3 grey scans, 300 dpi Flate                            |      17.01 |   88.1% |    96.4% |   98.1% | 0.9863 / 0.958 / 0.9416  |
| C03 3 bilevel scans, 300 dpi Flate                         |       0.23 | no file |  no file | no file | – / – / –                |
| D01 10 UI screenshots, Flate                               |       0.58 |   10.7% |    10.7% |   10.7% | 1.0 / 1.0 / 1.0          |
| E01 LibreOffice export: report with 8 photos               |       4.53 |   57.2% |    84.1% |   93.1% | 0.9974 / 0.9897 / 0.9729 |
| E02 LibreOffice export: 193 pages, 30 images               |       4.75 |   40.2% |    67.2% |   79.2% | 0.9988 / 0.9946 / 0.9861 |
| E03 LibreOffice export: text only                          |       0.09 |   32.6% |    32.6% |   32.6% | 1.0 / 1.0 / 1.0          |

Reading the table honestly:

- **Photo and scan documents shrink a lot** because the images are far above the target resolution (≈300–550 dpi → 150 dpi at Balanced). The synthetic images carry sensor-like noise, which downsampling removes; real photographs and scans will vary, and a PDF whose images are already at screen resolution gains little (see C03, G08).
- **Text-only files shrink only when the producer left streams uncompressed** (A01, A03, E03). An already-optimized text PDF (A02) is correctly reported as not reducible. Do not read A01's 65% as a typical text result.
- **Screenshots and diagrams are deliberately left lossless** (D01: 10.7%, from re-deflating only), because lossy JPEG damages text and sharp edges.
- Strong is visibly softer on scans: the worst sampled 200 dpi SSIM across the whole corpus is 0.894 (C02, Strong). That is why Strong is labelled "softer images" in the UI.

## Time and memory (Balanced)

| Case                                                       | Input (MB) | Pages | Time (s) | Peak renderer RSS (MiB) | Result  |
| ---------------------------------------------------------- | ---------: | ----: | -------: | ----------------------: | ------- |
| A01 40-page text, raw (unoptimized producer) streams       |       0.17 |    40 |      0.3 |                     144 | 65.5%   |
| B01 Office report, 5 photos 3000×2000 JPEG q90 at ~545 dpi |       8.51 |     6 |      0.9 |                     218 | 96.0%   |
| B02 4 camera photos 12 MP JPEG q92 at ~480 dpi             |      14.94 |     4 |      1.4 |                     284 | 96.3%   |
| C01 8 colour scans, 300 dpi JPEG q85                       |      11.73 |     8 |      1.9 |                     249 | 85.4%   |
| C02 3 grey scans, 300 dpi Flate                            |      17.01 |     3 |      1.9 |                     313 | 96.4%   |
| D01 10 UI screenshots, Flate                               |       0.58 |    10 |      3.9 |                     232 | 10.7%   |
| E01 LibreOffice export: report with 8 photos               |       4.53 |    49 |      1.4 |                     173 | 84.1%   |
| E02 LibreOffice export: 193 pages, 30 images               |       4.75 |   193 |      2.3 |                     196 | 67.2%   |
| E03 LibreOffice export: text only                          |       0.09 |     9 |      0.4 |                     149 | 32.6%   |
| G01 one 100 MP JPEG (over the 64 MP decode cap)            |       1.75 |     1 |      0.3 |                     140 | no file |
| G02 one 40 MP Flate image (over the 32 MP raster cap)      |       0.97 |     1 |      3.4 |                     370 | no file |
| G03 400 text pages                                         |       1.66 |   400 |      0.8 |                     154 | 65.5%   |
| G04 150 pages × 1200×900 JPEG                              |      37.59 |   150 |      5.9 |                     306 | 16.2%   |
| G05 1,000 text pages (page cap)                            |       2.86 |  1000 |      1.4 |                     164 | 63.4%   |
| G06 one 64 MP JPEG (exactly the decode cap)                |       4.71 |     1 |      1.4 |                     637 | 99.6%   |
| G07 190 pages × JPEG, 47.6 MB (near the 50 MiB cap)        |      47.62 |   190 |      7.5 |                     358 | 16.2%   |
| G08 1,000 pages × 1,000 small JPEG (image-count cap)       |      29.69 |  1000 |      1.3 |                     279 | no file |
| G09 one 31.5 MP Flate image (just under the raster cap)    |      46.73 |     1 |      3.9 |                     559 | 100.0%  |

Repeat variance (Balanced, ms): B01 [853, 819, 832], C01 [1885, 2365, 2361]. Idle page baseline is about 135 MiB renderer RSS.

## Boundary behaviour

- **Image over a decode cap is skipped, not attempted.** G01 (100 MP) and G02 (40 MP) produce no file and the page says `1 image skipped because of size, time or browser limits`; the PDF is not described as already compressed.
- **Caps are met by real successes.** G06 (64 MP JPEG) and G09 (31.5 MP raster) were processed at 637 and 559 MiB peak. These are the largest memory figures measured; a phone with less memory may fail where this VM did not (see ADR-025, launch gate).
- **Largest input** measured is 47.6 MB / 190 pages: 7.5 s, 358 MiB. 1,000 pages: 1.3–1.4 s.
- **Fixtures:** the signed fixture is compressed with a visible warning that the signature will no longer validate; the encrypted and corrupt fixtures end in the correct error messages with no output.

## Reproduce

```sh
pnpm build
uv run --with pikepdf --with pillow --with numpy --with scikit-image --with fonttools --with python-docx python tests/fixtures/generate_compress_benchmark.py
node apps/web/benchmarks/run-compress-pdf.mjs            # add --only=B01,G07 --merge to re-measure a subset
uv run --with pypdfium2 --with scikit-image --with numpy --with pillow python tests/fixtures/evaluate_compress_benchmark.py
```

Generated PDFs and outputs stay under the ignored `.tools/compress-benchmarks/`. The LibreOffice cases need `soffice` (use `--skip-soffice` otherwise).
