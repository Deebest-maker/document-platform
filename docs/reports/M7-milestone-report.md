# M7 Milestone Report: QA and hardening

**Date:** 2026-10-27
**Status:** M7G accepted by the Product Owner on 2026-11-04 and merged (`2f0c8bd`). Device run done on Windows (Chrome) and an Android phone; no Safari or iPhone run yet (see Device results and Decision 5).
**Part of:** governance §14.3. Slices: [M7A](M7A-milestone-report.md), [M7B](M7B-milestone-report.md), [M7C](M7C-milestone-report.md), [M7D](M7D-milestone-report.md), [M7E](M7E-milestone-report.md), [M7F](M7F-milestone-report.md), M7G (this slice), [M7H](M7H-milestone-report.md) (follow-up to finding 1).
**Checklist:** [`docs/qa/M7G-device-checklist.md`](../qa/M7G-device-checklist.md). **Test pack generator:** `tests/fixtures/generate_device_pack.py`.

## Summary

M7 turned "the tools work" into "the tools are shown to work, and to fail safely". Every claim about browsers, security, bad files, accessibility and speed is now a test that runs on every merge, and each test was shown to fail when the property it guards is broken. What no automated test can show is how the product behaves on a real phone, a real screen reader and real Safari. M7G is that list, with a test-file pack, written so the run takes about 40 minutes for the starred items.

## What each slice delivered

| Slice | Merged    | What changed                                                                                                                                                                                          |
| ----- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M7A   | `2110313` | CI tells the truth: a job per browser, named failures, red `main` fixed. One real bug found: Cancel at the moment an export finished left the page stuck.                                             |
| M7B   | `39d954d` | Word to PDF server limits per caller, bounded uploads, early expiry of unused jobs, security headers on its replies (ADR-033).                                                                        |
| M7C   | `03b4186` | Content Security Policy per page, worker policy, security headers, the site's own 404 and error pages (ADR-034). A header that stalled Firefox was measured and dropped.                              |
| M7D   | `2a7197c` | Every tool against every bad file; honest wording for the cause; the processor no longer blames the server for an unreadable document; every DOCX XML part scanned for DTDs (ADR-035).                |
| M7E   | `1a8d5b0` | Accessibility of every page and state by rules, keyboard, accessibility tree and enlarged text; reorder button names, 320 px overflow, Remove Metadata focus and table, Split field height (ADR-036). |
| M7F   | `e92acbb` | Measured budgets for weight, first use, layout shift, paint, tap time and caching; the page no longer jumps when a file is chosen; PDF.js files cached for a year (ADR-037).                          |
| M7G   | `2f0c8bd` | Device checklist, test pack, this record, and the findings below.                                                                                                                                     |
| M7H   | this PR   | A dropped connection is no longer blamed on the file: one new error, a helper for lazy imports, a rule for workers that never start, the connection words in every tool (ADR-038). Closes finding 1.  |

## Release criteria (document 08, section 10)

| Criterion                                                     | Evidence                                                                                                                                                                                                                           | Status                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| All P0 requirement-linked tests pass                          | CI is green in five browser engines on every merge: 217 to 220 browser tests per project, 420 web and 303 library unit tests, 249 processor tests. See finding 4: the requirement-to-test table that §12 asks for is not built.    | **Tests pass; traceability table open**                                            |
| No unresolved critical security issue                         | Abuse controls (M7B), CSP and headers (M7C), hostile-input matrix (M7D), dependency audit in CI (a failing audit is what turned `main` red on the M7F merge, finding 3). No known cross-user or privacy breach.                    | **Met by automation**; HTTPS, HSTS and the real proxy are M8                       |
| Core local tools pass network-leakage assertions              | Every browser test runs under a fixture that fails on any third-party request, and on any upload or processor request from a local tool; the CSP forbids other origins; airplane-mode check D1 below.                              | **Met by automation; device proof is D1**                                          |
| Supported browser smoke matrix passes                         | Desktop and phone Chromium, Firefox, WebKit, phone WebKit on every merge to `main`.                                                                                                                                                | **Met in engines; Windows Chrome and Android run; real Safari and iPhone not run** |
| Conversion fidelity spikes have GO/DEFER                      | Compress (ADR-025, shipped), PDF to Word deferred (ADR-027), Word to PDF limits from benchmarks (ADR-024).                                                                                                                         | **Met**                                                                            |
| Cleanup and retention pass on success, failure, timeout       | Processor lifecycle tests, janitor fix found in M4D, 10-minute idle expiry (ADR-032), early expiry of unused jobs (M7B).                                                                                                           | **Met**                                                                            |
| Accessibility journeys: automated plus keyboard manual review | 70 states per browser by rules, keyboard walk, accessibility tree and enlarged text (M7E). A human keyboard pass on Windows Chrome passed (G3); zoom, high contrast and a real screen reader (G1, G2, G4 to G6) were not reported. | **Automated met; keyboard pass met; screen reader not reported**                   |
| No severe layout shift or task-blocking regression            | Layout shift 0 while loading and at most 0.09 after choosing a file; paint 580 to 684 ms and taps 48 to 120 ms on a throttled phone, all enforced (M7F). Long tasks on a slow CPU are recorded, not enforced.                      | **Met in the lab; Windows Chrome passed (A, E); Android reported as passed**       |

## Device results

Run on 2026-11-03. The site was a production build served from the Product Owner's PC (`127.0.0.1:3100`); the phone reached it through a Cloudflare HTTPS tunnel (plain `http://` on the LAN does not work, finding 2).

**Windows, Chrome 155: run by me in the Product Owner's browser while he watched.**

- **PASS:** A1 to A10, B2, B4, C1, C2, C3, E1, E2, G3, H4.
- **SKIP:** G5 (the window could not be resized to a 200% or 400% zoom width from here, and zoom keys cannot be pressed).
- **Not run:** D1, E3, G4, G6, H1, H2, H3 (other browsers and settings), I1 (needs staging), and the phone-only checks (A11, B1, B3, E4, F1, G1, G2).
- **What the passes were:**
  - Every downloaded file was staged and opened with a PDF library, not judged from the screen.
  - A9: 5.4 MiB to 963 KiB (83% smaller) in under 10 seconds; 5 pages numbered IMAGE 1 to 5.
  - A6: a ZIP of four valid JPEGs in page order.
  - A10: page 1 upright with TOP at the top; the transparent PNG white in the middle (pixel checked).
  - E1: the 200-page file opened and exported without a tab reload (page memory about 35 MB); pages 199 and 200 swapped as asked.
  - E2: about 1 to 2 ms of script and about 20 ms to the next task per tap on a 50-page list.
  - G3: Tab reached every control in a sensible order, a 2 px focus outline always showed, and focus moved to the new heading after choosing files and after merging.
  - C1: "This PDF is password-protected. Unlock it before extracting text." C3: "No text layer was found", no download offered.

**Android phone: run by the Product Owner over the tunnel.** He reported that the testing passed. He did not give the device model, the browser or its version, or a line per check, and did not say whether the G2 error was read once or twice. The record therefore says only this: **Android, all checks he ran passed, as reported by him.** I have not written per-check results for Android that he did not give.

**Not tested at all:** Safari on an iPhone or a Mac. Document 08 §10 lists "Safari/iPhone spot check" in the manual-release tier. The WebKit engine is covered by CI on every merge (desktop and phone), which shows the code runs in WebKit, not how real iOS Safari handles the file picker, memory and HEIC photos (B3).

**New notes from this run** (none changes a file a tool produces):

- **NOTE, wording differs from the checklist (docs fixed in this PR).** B2 (a file with no `.pdf` in its name) is refused with "This file is not a supported PDF. Remove it and choose a PDF." in Merge, not "name ends in .pdf". C2 (a damaged file) is refused as "could not be opened as a PDF" in PDF to Text, Remove Metadata and Compress, and "damaged or unsupported" in Organize and the page tools. Both are honest; the checklist now lists both.
- **NOTE, S3 pending a screen-reader judgement: the error areas are verbose.** Some error panels are `role="alert"` regions that contain a heading, a long sentence and a button. A screen reader may read all of it as soon as it appears. ADR-036 flagged this; only a real screen-reader pass (G2 or G6) can say whether it is a problem. Not changed.
- **NOTE, Windows setup traps found while preparing the run (checklist section 2 now carries them):** `pnpm install` needs Node 24 (the repo sets `engine-strict`); a leftover `.next` folder from `next dev` makes `next build` fail with "routes.d.ts is not a module" (delete `apps\web\.next` and build again); a freshly installed `cloudflared` is not on an already open terminal's PATH; on a hotspot connection the default tunnel protocol dropped after about six minutes and `--protocol http2` fixed it; use `127.0.0.1`, not `localhost`.

## New findings in M7G

1. **A dropped connection is blamed on the file (S3).** If the connection drops after a page loads and before the first file is chosen, the library cannot load, and the tools blame the file: Split, Organize, Extract, Delete, Rotate and PDF to JPG say "This PDF could not be opened… Choose another PDF"; PDF to Text and Remove Metadata say "Try another PDF or try again later". (Compress and Merge fetch nothing at that step; Compress's wording was not tested.) The file is fine. Retrying after reconnecting works (checked on Split, PDF to Text, Remove Metadata). A visitor on a train or a weak signal would discard a good file. **Fixed in M7H** ([ADR-038](../adr/038-m7h-load-failure-wording.md)): a new error for "the tool's code could not load", with wording that names the connection, in every tool. Testing it also found Compress blaming the device's memory when its worker script was cut off, and a page that hung when the PDF.js worker never started; both are fixed there.
2. **On a page that is not secure, file choice does nothing and says nothing (S3).** The tools use a browser feature (`crypto.randomUUID`) that exists only on HTTPS or `localhost`. Over plain `http://192.168.x.x` the page loads and choosing a file silently does nothing (checked in Chromium). Production is HTTPS, so no visitor should meet it; it matters because it rules out the obvious way to test on a phone (the checklist gives three that work), and because five call sites could use a fallback at no cost.
3. **`main` went red on the M7F merge because of a new advisory, not because of any change.** Five high advisories in `undici` (HTTP, TLS and WebSocket clients) appeared after the pull request's last CI run; every browser, processor and container job passed and only the dependency-audit step failed. `undici` is reached only through the test tooling (`vitest` and `jsdom`); nothing shipped uses it. Pinned at the patched 8.12.2 as its own commit in this PR; the audit passes at "high". Two moderate Vitest advisories remain below the gate.
4. **The requirement-to-test table is not built.** Document 08 §12 asks that each P0 requirement and launch-critical NFR map to a test. Tests cite requirement IDs in their names for 23 of the SRS's 58 FRs and 3 of its 44 NFRs; the real coverage is much wider (Merge's four requirements are all tested, one is cited), but there is no table you can audit.

None changes any file a tool produces. I did not fix 1 or 2 inside this slice; 1 was fixed afterwards in M7H.

## Before launch (not M7)

- **You:** the iPhone/Safari run if you want it (Decision 5); the production domain, brand name and author line (unblocks M6D); hosting budget; final legal copy; delete the 21 `check/` branches (steps given earlier).
- **M8:** HTTPS edge with HSTS and `upgrade-insecure-requests`; purge the CDN on every deploy (pages are cacheable for a year); production proxy and body-size limits; monitoring; Word to PDF on staging (checklist I1); re-measure whether `Cross-Origin-Opener-Policy` can return on real Firefox.
- **M9:** advertising is weighed against the first-load script limit (180 KB), the CSP and the layout-shift budget before any script is added.

## Decisions

1. **Accept M7G** (the checklist, pack and this record): accepted 2026-11-04, merged `2f0c8bd`.
2. **Finding 1 and 2:** finding 1 is fixed in M7H, awaiting your acceptance. Finding 2 (plain HTTP) stays optional: production is HTTPS.
3. **Finding 4:** build the table now, before M8, or accept the current coverage. My recommendation: build it (I can draft it from the tests; you check it), because document 08 makes it a release gate.
4. **Limits and budgets:** your Android report names no limit or budget as wrong, so ADR-017, 018, 025 and 037 stand. If a later device run shows otherwise, they change in a follow-up.
5. **The missing Safari and iPhone run:** accept the gap (CI covers the WebKit engine, not real iOS Safari), or borrow an iPhone and run the starred checks (about 40 minutes; HEIC photos, the file picker and memory are what only it can show). My recommendation: run it before public launch, not before accepting M7G; it can happen on the M8 staging site, where no tunnel is needed.

## Verification of this slice

- **The test pack was run, not assumed.** Every file went through its tool in Chromium here: Merge gave 4 pages; Organize accepted 50 and 200 pages; Compress took the heavy file from 5.4 MiB to 964 KiB; Remove Metadata, PDF to Text (no text layer, and the partly scanned note), the refusals, and Images to PDF (page 1 upright and portrait, the transparent PNG white in the middle, checked by rendering the output) all behaved as the checklist says. The password-protected file is reported as "damaged or unsupported" by the Chromium here (the known environment difference in M7D); the checklist accepts either wording.
- **What I tested for the checklist's claims:** airplane mode (second run offline) works for Merge, Compress, PDF to Text and Organize with no failed requests; a plain-HTTP page breaks file choice; reconnecting recovers the PDF tools.
- **Not run from here:** the HTTPS tunnel and USB port-forwarding commands (both standard tools; steps are in the checklist), and everything on a real device.
- **Unit tests** 420 web and 303 library pass with the pinned `undici`; types and format pass. **Five-browser CI at `2e47d0c`:** all nine jobs pass (desktop and phone Chromium, Firefox, WebKit, phone WebKit, the processor and its container, and the web quality job with the dependency audit, which is what turned `main` red).

## Files

- `docs/qa/M7G-device-checklist.md`, `tests/fixtures/generate_device_pack.py`, this report.
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`: `undici` pinned.
- Records: M7F's merge (`e92acbb`) in ADR-037, the index, the M7F report and the governance M7 row.
