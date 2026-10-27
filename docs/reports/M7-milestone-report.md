# M7 Milestone Report: QA and hardening

**Date:** 2026-10-27
**Status:** Implemented; owner acceptance pending. The device run (the checklist below) is yours and completes it.
**Part of:** governance §14.3. Slices: [M7A](M7A-milestone-report.md), [M7B](M7B-milestone-report.md), [M7C](M7C-milestone-report.md), [M7D](M7D-milestone-report.md), [M7E](M7E-milestone-report.md), [M7F](M7F-milestone-report.md), M7G (this slice).
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
| M7G   | this PR   | Device checklist, test pack, this record, and the findings below.                                                                                                                                     |

## Release criteria (document 08, section 10)

| Criterion                                                     | Evidence                                                                                                                                                                                                                        | Status                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| All P0 requirement-linked tests pass                          | CI is green in five browser engines on every merge: 217 to 220 browser tests per project, 420 web and 303 library unit tests, 249 processor tests. See finding 4: the requirement-to-test table that §12 asks for is not built. | **Tests pass; traceability table open**                                        |
| No unresolved critical security issue                         | Abuse controls (M7B), CSP and headers (M7C), hostile-input matrix (M7D), dependency audit in CI (a failing audit is what turned `main` red on the M7F merge, finding 3). No known cross-user or privacy breach.                 | **Met by automation**; HTTPS, HSTS and the real proxy are M8                   |
| Core local tools pass network-leakage assertions              | Every browser test runs under a fixture that fails on any third-party request, and on any upload or processor request from a local tool; the CSP forbids other origins; airplane-mode check D1 below.                           | **Met by automation; device proof is D1**                                      |
| Supported browser smoke matrix passes                         | Desktop and phone Chromium, Firefox, WebKit, phone WebKit on every merge to `main`.                                                                                                                                             | **Met in engines; real Safari, Android and iPhone are the checklist (A to H)** |
| Conversion fidelity spikes have GO/DEFER                      | Compress (ADR-025, shipped), PDF to Word deferred (ADR-027), Word to PDF limits from benchmarks (ADR-024).                                                                                                                      | **Met**                                                                        |
| Cleanup and retention pass on success, failure, timeout       | Processor lifecycle tests, janitor fix found in M4D, 10-minute idle expiry (ADR-032), early expiry of unused jobs (M7B).                                                                                                        | **Met**                                                                        |
| Accessibility journeys: automated plus keyboard manual review | 70 states per browser by rules, keyboard walk, accessibility tree and enlarged text (M7E). A human keyboard pass and real screen readers are G1 to G6.                                                                          | **Automated met; human review is the checklist**                               |
| No severe layout shift or task-blocking regression            | Layout shift 0 while loading and at most 0.09 after choosing a file; paint 580 to 684 ms and taps 48 to 120 ms on a throttled phone, all enforced (M7F). Long tasks on a slow CPU are recorded, not enforced.                   | **Met in the lab; real phones are A to F**                                     |

## New findings in M7G

1. **A dropped connection is blamed on the file (S3).** If the connection drops after a page loads and before the first file is chosen, the library cannot load, and the tools blame the file: Split, Organize, Extract, Delete, Rotate and PDF to JPG say "This PDF could not be opened… Choose another PDF"; PDF to Text and Remove Metadata say "Try another PDF or try again later". (Compress and Merge fetch nothing at that step; Compress's wording was not tested.) The file is fine. Retrying after reconnecting works (checked on Split, PDF to Text, Remove Metadata). A visitor on a train or a weak signal would discard a good file. Fix: a new error for "the tool's code could not load", with wording that names the connection, in about six message tables.
2. **On a page that is not secure, file choice does nothing and says nothing (S3).** The tools use a browser feature (`crypto.randomUUID`) that exists only on HTTPS or `localhost`. Over plain `http://192.168.x.x` the page loads and choosing a file silently does nothing (checked in Chromium). Production is HTTPS, so no visitor should meet it; it matters because it rules out the obvious way to test on a phone (the checklist gives three that work), and because five call sites could use a fallback at no cost.
3. **`main` went red on the M7F merge because of a new advisory, not because of any change.** Five high advisories in `undici` (HTTP, TLS and WebSocket clients) appeared after the pull request's last CI run; every browser, processor and container job passed and only the dependency-audit step failed. `undici` is reached only through the test tooling (`vitest` and `jsdom`); nothing shipped uses it. Pinned at the patched 8.12.2 as its own commit in this PR; the audit passes at "high". Two moderate Vitest advisories remain below the gate.
4. **The requirement-to-test table is not built.** Document 08 §12 asks that each P0 requirement and launch-critical NFR map to a test. Tests cite requirement IDs in their names for 23 of the SRS's 58 FRs and 3 of its 44 NFRs; the real coverage is much wider (Merge's four requirements are all tested, one is cited), but there is no table you can audit.

None changes any file a tool produces. I did not fix 1 or 2 inside this slice.

## Before launch (not M7)

- **You:** run the device checklist; the production domain, brand name and author line (unblocks M6D); hosting budget; final legal copy; delete the 21 `check/` branches (steps given earlier).
- **M8:** HTTPS edge with HSTS and `upgrade-insecure-requests`; purge the CDN on every deploy (pages are cacheable for a year); production proxy and body-size limits; monitoring; Word to PDF on staging (checklist I1); re-measure whether `Cross-Origin-Opener-Policy` can return on real Firefox.
- **M9:** advertising is weighed against the first-load script limit (180 KB), the CSP and the layout-shift budget before any script is added.

## Decisions

1. **Accept M7G** (the checklist, pack and this record) — for you to say. I will not merge until you do.
2. **Finding 1 and 2:** fix now as a small M7H (wording in about six message tables, one helper for five call sites, one browser test each), or schedule before launch, or accept. My recommendation: fix 1 before launch (a good file thrown away on a weak signal is the most likely real-world complaint); 2 is optional.
3. **Finding 4:** build the table now, before M8, or accept the current coverage. My recommendation: build it (I can draft it from the tests; you check it), because document 08 makes it a release gate.
4. **After your device results:** limits that prove too high for real phones (ADR-017, 018, 025) and any budget that proves wrong (ADR-037) are changed in a follow-up.

## Verification of this slice

- **The test pack was run, not assumed.** Every file went through its tool in Chromium here: Merge gave 4 pages; Organize accepted 50 and 200 pages; Compress took the heavy file from 5.4 MiB to 964 KiB; Remove Metadata, PDF to Text (no text layer, and the partly scanned note), the refusals, and Images to PDF (page 1 upright and portrait, the transparent PNG white in the middle, checked by rendering the output) all behaved as the checklist says. The password-protected file is reported as "damaged or unsupported" by the Chromium here (the known environment difference in M7D); the checklist accepts either wording.
- **What I tested for the checklist's claims:** airplane mode (second run offline) works for Merge, Compress, PDF to Text and Organize with no failed requests; a plain-HTTP page breaks file choice; reconnecting recovers the PDF tools.
- **Not run from here:** the HTTPS tunnel and USB port-forwarding commands (both standard tools; steps are in the checklist), and everything on a real device.
- **Unit tests** 420 web and 303 library pass with the pinned `undici`; types and format pass. CI result is on the pull request.

## Files

- `docs/qa/M7G-device-checklist.md`, `tests/fixtures/generate_device_pack.py`, this report.
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`: `undici` pinned.
- Records: M7F's merge (`e92acbb`) in ADR-037, the index, the M7F report and the governance M7 row.
