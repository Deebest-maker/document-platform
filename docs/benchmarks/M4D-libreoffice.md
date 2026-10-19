# M4D LibreOffice benchmark results

Executes the methodology in [`M4B-libreoffice.md`](M4B-libreoffice.md). Raw data: [`M4D-libreoffice-results.json`](M4D-libreoffice-results.json). Harness: `services/processor/tools/m4d_benchmark.py`.

Re-run: `cd services/processor && uv run python -m tools.m4d_benchmark --out ../../docs/benchmarks/M4D-libreoffice-results.json --label "<host>"`.

## Read this first: what these numbers are and are not

- **Host, not production image.** Measured on a cloud dev container (2 vCPU Xeon 2.1 GHz, 8 GiB, Ubuntu 24.04, LibreOffice 24.2.7, qpdf 11.9, Python 3.13). The production image is Debian bookworm with its own LibreOffice build. No Docker daemon was available. **The harness must be re-run inside the real image on the M8 staging host before launch.** Treat every number below as a defensible provisional value, not a production guarantee.
- **Pipeline timing only.** DOCX preflight → LibreOffice → PDF validation, in process. HTTP and network transfer are excluded.
- **Synthetic corpus.** Built from the standard library, no real user documents. It measures speed and memory. It **cannot** judge layout fidelity; that is covered by the manual acceptance script in the M4D milestone report.
- **Cold start every job.** The engine starts a fresh LibreOffice process with a fresh profile per job (by design), so each figure includes cold start. The smallest document (W1) costs about 1.25 s, which is the floor.
- Sample sizes are small (4 measured runs for W1–W4, 2 for the heavy ones, after one discarded warm-up). Medians are stable (worst p95 is 17% above its median, and with 4 runs p95 is effectively the maximum) but this is not a statistical study.

## Results (medians)

| ID  | Workload                                     | Input   | Pages | Convert | Total pipeline | Peak RSS | Output  |
| --- | -------------------------------------------- | ------- | ----: | ------: | -------------: | -------: | ------- |
| W1  | Minimal paragraph                            | 1.4 KiB |     1 |  1.25 s |         1.27 s |  246 MiB | 16 KiB  |
| W2  | ~10-page report                              | 6.4 KiB |     9 |  1.32 s |         1.34 s |  215 MiB | 48 KiB  |
| W3  | ~50 pages, tables, images                    | 2.1 MiB |    49 |  1.97 s |         2.07 s |  218 MiB | 323 KiB |
| W4  | ~200 pages, embedded images                  | 10 MiB  |   193 |  3.47 s |         3.77 s |  247 MiB | 1.0 MiB |
| W5  | Near current input limit                     | 19 MiB  |    68 |  2.27 s |         2.39 s |  251 MiB | 310 KiB |
| W6  | Governance-doc maximum (above current limit) | 50 MiB  |    91 |  2.74 s |         2.90 s |  361 MiB | 378 KiB |
| W7  | One large photo-sized raster (2000×2000)     | 11 MiB  |     2 |  1.56 s |         1.70 s |  274 MiB | 515 KiB |
| W8  | ~1,000-page text document                    | 533 KiB |  1018 | 13.95 s |        15.53 s |  277 MiB | 4.6 MiB |
| H1  | Pixel bomb 12000×12000 PNG (engine-only run) | 15 KiB  |     1 |  5.37 s |         5.38 s |  612 MiB | 18 KiB  |

No workload failed in any run. W8 shows conversion cost is about **13.7 ms per page**.

### Rejections (all `invalid_input`, all well under the 100 ms gate)

R1 macro part, R2 encrypted package, R3 ZIP bomb (50 MiB of zeros), R4 legacy `.doc`, R5 path traversal entry, R6 zero-byte file. Median rejection time ≤ 0.1 ms; worst p95 2.2 ms.

### Concurrency probe (W3, same host)

| Parallel conversions | Wall time (median) | Throughput | Peak RSS (sum) |
| -------------------: | -----------------: | ---------: | -------------: |
|                    1 |             2.08 s |    0.48 /s |        221 MiB |
|                    2 |             2.38 s |    0.84 /s |        437 MiB |
|                    4 |             4.26 s |    0.94 /s |        867 MiB |

Running two at once would give about 1.75× throughput on 2 vCPU but doubles memory and breaks the governance §9.3 baseline of exactly one on-disk conversion at a time. Serialized capacity for W3-size documents is therefore about **0.5 conversions per second (~1,700 per hour)** per processor.

## Decision gates (from M4B methodology) applied to the data

| Gate                   | Formula                           | Result                                                                   |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| Container memory       | 2× peak measured RSS              | 503 MiB normal; 548 MiB with large raster; **1,223 MiB** with pixel bomb |
| Disk workspace per job | 2× peak workspace                 | 40 MiB for inputs at the current 20 MiB limit                            |
| Page-count bound       | 2× max observed, capped at 1,000  | Formula gives 1,000; uncapped 2× would be 2,036 (see ADR-024 decision)   |
| Concurrency            | W3 < 2 s → may consider >1 later  | W3 convert median 1.97 s: marginal; decision is to keep 1 (ADR-024)      |
| Timeout                | Slowest legitimate case vs. 120 s | Slowest legitimate case 15.5 s; about 8× headroom                        |
| Rejection speed        | < 100 ms                          | All pass                                                                 |

## Known gaps in this evidence

1. Production image not measured (see top).
2. Fidelity (fonts, layout, tracked changes, complex tables) not measured; needs real Word documents.
3. The pixel bomb (H1) is stopped by the preflight ZIP-ratio check before LibreOffice sees it. An image with large dimensions but a compression ratio under that threshold was not tested. The engine-only H1 run shows what LibreOffice does with such an image (completes, 612 MiB, 5.4 s), which is why memory sizing uses it. Image-dimension preflight and a memory rlimit are deferred to M7.
4. Small sample sizes (see top).
