# M3A.3 Split PDF product benchmark

Date: 2026-10-06

## Scope

This focused synthetic benchmark exercises the production `/split-pdf` route at the 200-page input and 20-output engineering boundaries. Each output contains ten pages and the resulting PDFs are packaged into one stored ZIP. It runs desktop and emulated mobile Chromium, records local timings, output sizes and a best-effort JavaScript heap delta, and checks local-only requests and horizontal reflow. It is not a public performance or memory guarantee.

Deterministic unit and worker tests separately cover cooperative cancellation during a batch and cancellation before archive publication. `zipSync` is synchronous, so cancellation cannot interrupt the archive call itself; a cancellation observed after the call still suppresses the result.

## Reproduction

After a production build, run:

```text
node apps/web/benchmarks/run-split.mjs
```

Machine-readable results are written to `M3A3-split-results.json`. Screenshots and representative archives remain ignored under `.tools/split-review/`.

## Result

- Desktop loaded the 200-page plan in 487 ms and generated, validated and archived 20 outputs in 932 ms.
- Emulated mobile Chromium loaded the plan in 1,101 ms and generated the same archive in 1,584 ms.
- Each run produced 581,680 combined PDF bytes and a 583,702-byte ZIP containing the exact 20 fixed-name entries.
- Both viewports had no horizontal overflow and emitted only first-party GET requests without request bodies.
- Chromium's coarse `performance.memory` counter reported no observable delta at the two sample points. This is not a claim of zero allocation; the retained payload evidence is the combined PDF and final archive byte count above.

The 20-output, 64 MiB combined-PDF and 64 MiB ZIP caps remain conservative for this project-authored workload. Results vary by document complexity and device.
