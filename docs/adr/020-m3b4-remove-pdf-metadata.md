# ADR-020: Remove PDF Metadata (M3B.4)

**Status:** Accepted
**Date:** 2026-10-12
**Milestone:** M3B.4
**Scope:** `apps/web/app/remove-pdf-metadata`, `packages/pdf-browser/src/metadata-removal*`, `packages/tool-registry/src/catalog.ts`.

## Context

M3B.4 adds the tenth local tool to the platform: **Remove PDF Metadata**. The owner-facing promise is narrow: strip the metadata the PDF format exposes as discrete, structured fields, in the browser, without ever sending the document to a server. The tool is not — and must never be sold as — secure redaction.

Three families of metadata are in scope:

1. **Document Information dictionary** (ISO 32000-1 §14.3.3). The standard entries (`/Title`, `/Author`, `/Subject`, `/Keywords`, `/Creator`, `/Producer`, `/CreationDate`, `/ModDate`, `/Trapped`) plus any custom entries authoring tools add alongside them.
2. **XMP metadata stream** attached to the Catalog as `/Metadata`.
3. **Trailer identifier** (`/ID`) — treated as a **SPIKE** per the user's own M3B.4 brief. Whether this build can suppress `/ID` on save depends on pdf-lib's current serializer behaviour; the engine observes the saved output and reports the real outcome.

Explicitly **out of scope**: text and image content on each page, embedded fonts, embedded files/attachments, incremental-update history, digital signatures, structure tree (`/StructTreeRoot`), optional-content configuration, named destinations, and anything inside page content streams. Removing those is a different tool and a different conversation (one of them, "secure redaction", we do not plan to build in M4).

## Decision

### 1. Build on `pdf-lib`

The same browser engine M2A and M3A/B rely on. No new runtime dependency, no new native/WASM module, no new worker contract.

- `PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })` reads the file. `updateMetadata: false` keeps pdf-lib from stamping its own `/ModDate` and `/Producer` on load (that would defeat the whole tool).
- Removal is three primitive operations:
  - For every Info-dictionary key: `infoDict.delete(key)`, then `delete trailerInfo.Info` so the serializer emits no `/Info` entry at all.
  - For XMP: `catalog.delete(PDFName.of("Metadata"))`.
  - For trailer `/ID`: `delete trailerInfo.ID` (SPIKE — see §3).
- `source.save({ useObjectStreams: false })` produces the output. `useObjectStreams: false` matches the rest of the platform and keeps the output legible to third-party tools.

### 2. Verification — structurally scoped in production, broader in tests

**Production publication gate: pdf-lib reopen.** After save, the engine reopens the saved bytes in a fresh `PDFDocument` and snapshots the Document Information dictionary, the Catalog `/Metadata` reference and the trailer `/ID`. It also compares page count, per-page `/MediaBox` and per-page rotation against the before snapshot. Every one of these checks is structurally scoped by pdf-lib's parser — it looks at the specific PDF object the field lives in, not at arbitrary byte positions in the file — so none can false-positive on a lookalike byte sequence elsewhere. If any targeted field survived in the reopen snapshot, the engine throws `OUTPUT_INVALID` and publishes nothing.

**Narrow structural second opinion for the trailer /ID SPIKE.** Trailer `/ID` removal is the SPIKE, so the engine also runs `scanTrailerIdStructural` (in `packages/pdf-browser/src/metadata-removal-verify.ts`). This scanner reads a **bounded slice** of the saved bytes from the final `trailer` keyword to the following `startxref` and looks for `/ID` inside that slice only. Any `/ID` appearing elsewhere in the body — inside an optional-content configuration name tree, for instance — is deliberately ignored, so this scan cannot false-positive outside the trailer. When it sees an `/ID` that pdf-lib's reload missed, the engine down-corrects `trailerIdControllable` to `false`. The engine never promotes the SPIKE outcome; it can only make it more cautious.

**Test-and-benchmark-only whole-body scan.** A broader whole-body scanner (`scanWholeBody` in `packages/pdf-browser/tests/helpers/metadata-whole-body-scan.ts`) exists for test and benchmark use only. It walks the whole Latin-1-decoded body and reports whether metadata-shaped tokens appear anywhere. **It is NOT reachable from any production code path, is NOT re-exported from the `./metadata-removal` subpath, and NOT attached to `MetadataRemovalResult`.** A global regex can false-positive on legitimately-placed byte sequences (a `/Title` key inside an unrelated name tree, say), so it must never gate publication. Tests use it as a bug detector to flag suspicious output for a human.

**Optional out-of-tree cross-check.** `tests/fixtures/scripts/verify-metadata-removal-independent.py` can be run ad-hoc with `uv pip install pypdf` to parse the output through pypdf — a different Python PDF library — and re-check the same invariants against the Info dictionary and Catalog. This script is NOT added to any project lockfile; it is extra defence in depth and CI gates do not depend on it.

### 3. Trailer `/ID` is a SPIKE

The user's brief classifies trailer `/ID` removal as a **SPIKE** — we are investigating whether it is reliably controllable, not committing that it is. The engine's behaviour matches that status:

- The engine attempts to detach `/ID` before save.
- It then reopens the saved bytes and observes whether `/ID` is actually absent.
- It reports `trailerIdControllable: boolean` in the result. The UI only tells the owner "the trailer identifier was removed" when `trailerIdControllable && before.trailerIdPresent`.
- When `trailerIdControllable` is `false`, the UI shows a note: "This build was not able to suppress the trailer identifier for this PDF."

We never claim removal we cannot verify. We never silently discard the finding either.

### 4. Content preservation — what we actually verify, and what we don't claim

Four properties about page content are checked:

- **Page count** — number of pages after save equals before.
- **MediaBox** — per-page `/MediaBox` after save equals before, element-by-element.
- **Rotation** — per-page `/Rotate` after save equals before.
- **On-page text canaries** — the engine does not know what text is on each page, so this claim lives in tests and benchmarks: `metadata-rich.pdf`'s content stream renders the literal strings `page 1`, `page 2`, `page 3` through `(…) Tj` operators. The byte-level verifier confirms those substrings survive in the saved bytes. If a future engine change ever touches a content stream, this canary set catches it.

What this ADR **does not claim**:

- Byte-identical whole-PDF output. pdf-lib re-serializes the file; the whole-document bytes change. That is expected.
- Preservation of embedded files, incremental-update history, digital signatures, structure trees (`/StructTreeRoot`), optional-content configuration, named destinations, bookmarks, or any content inside `/XObject` form streams. The engine does not touch any of those, but it does not independently verify them either. The owner should treat Remove PDF Metadata as a metadata-only tool.

### 5. Not secure redaction — stated three ways

- The ADR says it (this document).
- The route page shows a note **before** the owner selects a file: "This tool removes supported metadata (Document Information fields, the XMP metadata stream, and — where this build is able — the trailer identifier). It is **not** secure redaction: text and images on each page are preserved as-is. Content embedded in the pages themselves is not touched."
- The privacy page carries the same wording in the per-tool table.

Owner acceptance for M3B.4 includes reading this disclosure in situ. An E2E test (`NFR-UX-010`) asserts the disclosure is in the DOM on first paint.

### 6. Fixed output filename

The downloaded file is always named `metadata-removed.pdf`. The source filename never flows into the output name, the Blob URL, the download attribute, the clipboard payload, any announcement or any URL. This matches the project-wide output-naming rule used by `/pdf-to-text` (`extracted-text.txt`) and `/jpg-to-pdf` (`images-to-pdf.pdf`), and preserves the user's privacy when the browser's download dialog surfaces the suggested filename.

### 7. Privacy budget

The audit matches the strict context-wide pattern already used by `/pdf-to-text` — not a relaxed "only POST bodies" check.

- **No document bytes leave the browser.** The Playwright privacy audit on `/remove-pdf-metadata` enforces, for the `metadata-rich.pdf` fixture, that for **every** network request the context makes (not just non-GET ones):
  - Method is `GET` or `HEAD`.
  - URL stays same-origin or uses the `blob:`/`data:`/`about:` schemes.
  - Pathname does not match `/^\/(api|v1|ingest|collect|rpc)\//`.
  - **URL, request headers and request body** are each independently checked for the fixture's four canaries (`SECRET-TITLE-CANARY-9Hjk`, `SECRET-AUTHOR-CANARY-2Fqz`, `ACME-INTERNAL-CANARY-X3b`, `XMP-CANARY-V7m`) and for the source-filename canary injected by the test.
  - No console message contains any canary.
  - **No WebSocket upgrade** was observed on either the context's `websocket` event or the page's `websocket` event — a LOCAL tool must never open one.
  - `localStorage`, `sessionStorage` and **IndexedDB** are empty (no database the page caused to be created).
- The same assertion suite is applied to `/pdf-to-text` E2E in `apps/web/e2e/pdf-to-text.spec.ts` so both new LOCAL tools share identical privacy coverage.
- **No metadata values enter logs, analytics or telemetry.** The engine's result surface returns `MetadataSnapshotFlags` (booleans and key names only). Raw string values (titles, author names) never cross the engine boundary. The session mirrors this: its snapshot carries counts, not strings.
- Benchmark output (`docs/benchmarks/M3B4-remove-pdf-metadata-results.json`) is schema-only on first commit and must stay free of document bytes when regenerated.

### 6. Engineering limits

Inherit the shared `localPageLimits` (10 MiB in, 200 pages, 32 MiB out). The output of metadata removal is nearly always smaller than the input, so the output cap is a safety net rather than a working constraint. Values live in the catalog, not the engine, so a future review can change them without engine edits.

## Consequences

- **Users get an honest tool.** It does what its name says, and nothing more. We do not misrepresent it as redaction.
- **The trailer-/ID SPIKE is live in production.** When pdf-lib's serializer refuses to drop `/ID` for a given document, the owner is told that fact, not told the file is clean when it isn't. If a future pdf-lib release changes this behaviour, the engine will quietly start reporting the stronger outcome; no engine code change needed.
- **No new deps.** M3B.4 adds no dependency not already in the tree.
- **M4 is not unlocked.** Compress PDF, Word→PDF and PDF→Word remain `planned`. Document-level server endpoints remain unimplemented. No authentication, database, queue, cloud storage, analytics, or OCR work is in this milestone.

## Alternatives considered

- **Reading the file as raw bytes and byte-splicing the Info dict out.** Faster for large files, dramatically harder to get right, defeats the independent-verification pattern (there is no "reopen" step to catch regressions). Rejected.
- **Shipping a "secure redaction" claim and letting the owner read small print.** The platform-wide stance is that we do not describe a tool as something it is not. Rejected.
- **Deferring trailer /ID until a future milestone.** Would have left a user-visible leak with no mention. The SPIKE pattern — attempt, verify, report truthfully — is strictly better than silence.

## Links

- Milestone brief: `docs/reports/M3B4-milestone-report.md`
- Engine: `packages/pdf-browser/src/metadata-removal.ts`, `metadata-removal-types.ts`
- Tests: `packages/pdf-browser/tests/metadata-removal.test.ts`, `apps/web/tests/remove-pdf-metadata-session.test.ts`, `apps/web/e2e/remove-pdf-metadata.spec.ts`
- Benchmark: `apps/web/benchmarks/run-remove-pdf-metadata.mjs`
- Fixture: `tests/fixtures/pdf/metadata-rich.pdf`, `tests/fixtures/scripts/generate-metadata-rich.mjs`, `tests/fixtures/pdf/METADATA-RICH-MANIFEST.md`
