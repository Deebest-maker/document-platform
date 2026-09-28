# M2B preview and page-operation benchmark

Date: 2026-09-28. Browser: Chromium 153.0.8010.12 on Windows, AMD Ryzen 7 5700G, 32 GiB RAM. These are synthetic engineering measurements on one development machine, not launch promises or physical-mobile evidence.

The harness dynamically generated mixed-font/rotation PDFs at 10, 50, 100, 200 and 201 pages plus a 50-page, 6.0 MiB image-heavy PDF. It rendered visible batches, repeatedly moved between the beginning/end, rotated, paused an in-flight render, performed a real structural export, resumed, then destroyed the document. Every request remained on the loopback origin. Raw results are in [M2B-preview-results.json](M2B-preview-results.json); precise Chromium heap samples for the two larger cases are in [M2B-preview-memory.json](M2B-preview-memory.json).

## Concurrency decision

| Emulation                         | Concurrency | Median first 8-page batch | Observed range | Longest long task | Max owned canvas bytes |
| --------------------------------- | ----------: | ------------------------: | -------------: | ----------------: | ---------------------: |
| Desktop 1280 × 900, DPR 1         |           1 |                    488 ms |     386–507 ms |              0 ms |               2.29 MiB |
| Desktop 1280 × 900, DPR 1         |           2 |                    421 ms |     378–513 ms |              0 ms |               2.29 MiB |
| Desktop 1280 × 900, DPR 1         |           4 |                  2,047 ms |   607–3,347 ms |            145 ms |               2.29 MiB |
| Mobile 390 × 844, requested DPR 3 |           1 |                    602 ms |   385–1,693 ms |             89 ms |               9.14 MiB |
| Mobile 390 × 844, requested DPR 3 |           2 |                    522 ms |   392–1,230 ms |            102 ms |               9.14 MiB |
| Mobile 390 × 844, requested DPR 3 |           4 |                    889 ms |   449–1,489 ms |            102 ms |               9.14 MiB |

Select **concurrency 1**. Concurrency 2 improved the median by about 14% desktop and 13% mobile, while adding simultaneous decoder/canvas pressure and still producing a mobile long task. Concurrency 4 regressed both medians materially. The lowest concurrency gives bounded, acceptable progressive rendering and simpler cancellation behavior.

Keep at most eight visible/nearby canvases. Width is capped at 240 CSS pixels, height at 320, effective DPR at 2, and each backing store at 307,200 pixels. The largest observed backing-store total was 2,396,160 pixels (9.14 MiB RGBA). These bounds cover owned canvases only; they do not claim to bound browser, PDF.js decoder, font, GPU or document-source memory.

## Lifecycle and boundary evidence

- Preview plus structural export peaked at two workers: one owned PDF.js worker and one structural worker. Export paused rendering; active renders reached zero before structural work and resumed afterward.
- Every case ended with zero owned workers and zero canvas backing-store pixels. Pause/cancellation settled in 0.6–2.4 ms in the precise-memory cases.
- The 201-page input failed with `PAGE_LIMIT` before creating a worker. The 200-page and image-heavy inputs completed preview and validated export within the documented byte/page/output caps.
- With precise heap reporting enabled, three repeated scroll/rotate cycles changed sampled JavaScript heap by approximately +202 KiB for mixed 200 pages and +242–272 KiB for image-heavy 50 pages. Samples were non-monotonic in the image cases. This is a trend check, not total-memory accounting or proof of secure erasure.
- The mobile rows are viewport/DPR emulation on desktop Chromium. No physical-mobile performance evidence exists yet.
