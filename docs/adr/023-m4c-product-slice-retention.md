# ADR-023: M4C Product Slice & Retention Policy

**Status:** Implemented under the approved M4C gate; owner acceptance pending
**Date:** 2026-10-17
**Milestone:** M4C — Product Slice & Retention Policy
**Scope:** `packages/tool-registry/src/catalog.ts`, `packages/tool-registry/src/privacy.ts`, `apps/web/components/word-to-pdf/`, `apps/web/app/word-to-pdf/page.tsx`, `apps/web/next.config.ts`; matching tests and E2E.

## Context

M4B delivered a working LibreOffice conversion pipeline behind the processor API. M4C activates the Word-to-PDF tool in the web application so users can convert DOCX documents through the browser. This is the first server-processed tool to go live, requiring privacy disclosure before upload, upload progress, a conversion waiting state, and client-side cleanup of server resources.

Governance §9 mandates that retention be "Product Owner-approved after M4B benchmark evidence." The current `job_lifetime_seconds` default is 15 minutes (the janitor safety net). Normal flow deletes the job workspace immediately after the client downloads the result — the `WordToPdfSession.run()` method calls `deleteJob` as soon as the blob is fetched, so server-side artifacts typically live for the duration of a single HTTP round-trip sequence (seconds, not minutes). The 15-minute janitor sweep is a safety net for abandoned jobs, not the primary retention mechanism.

## Decision

### 1. Registry activation (`catalog.ts`)

`word-to-pdf` moves from `availability: "planned"` to `availability: "available"` with `featured: true`. Limits are aligned with the processor's config defaults:

- `maxFiles: 1` — single-file conversion.
- `maxFileBytes: 20 MiB` — matches `PROCESSOR_MAX_INPUT_BYTES`.
- `maxTotalBytes: 20 MiB` — same; single file.
- `maxPages: 0` — page counting is server-side only; the client does not enforce a page limit for server tools.
- `maxOutputBytes: 32 MiB` — matches `PROCESSOR_MAX_OUTPUT_BYTES`.

### 2. Privacy presentation (`privacy.ts`)

A new `SERVER + available` branch returns the live wording per UX Spec §8:

- **Label:** "Secure server processing"
- **Explanation:** "Your file is uploaded to our processing server over an encrypted connection, converted, and deleted automatically. The file is never shared with third parties."

This is distinct from the planned wording, which warns that the tool is not available yet. The `LOCAL + available` and all planned-mode presentations remain unchanged.

### 3. Next.js API proxy (`next.config.ts`)

A rewrite rule proxies `/api/processor/:path*` to `${PROCESSOR_ORIGIN}/v1/:path*` (defaults to `http://localhost:8000`). This avoids CORS configuration for the browser-to-processor path and keeps the processor origin out of client-side code.

### 4. Processor API client (`api.ts`)

A typed client for the processor job endpoints:

- `createJob()` — POST to create a job, returns ID and capability token.
- `uploadInput()` — PUT with XMLHttpRequest for upload progress events (fetch does not support `xhr.upload.onprogress`).
- `convert()` — POST, blocks until conversion completes (synchronous endpoint).
- `downloadOutput()` — GET, returns the PDF as a Blob.
- `deleteJob()` — DELETE, fire-and-forget cleanup.

The token is held in a closure and never persisted. All endpoints are called through the Next.js proxy path.

### 5. WordToPdfSession (`session.ts`)

An external store following the `MergeSession` pattern:

- **States:** idle → selected → uploading → converting → result | error.
- **Generation tracking** prevents stale callbacks from updating state after cancellation.
- **AbortController** threads through upload, convert and download calls.
- **Client-side validation:** rejects non-.docx extensions, empty files, and files exceeding `maxFileBytes` before any network request.
- **Server cleanup:** `deleteJob` is called after successful download or on any error, so server artifacts don't linger.
- **pagehide listener:** calls `reset()` on navigation to dispose of blob URLs and clean up server resources.

### 6. Workspace component (`word-to-pdf-workspace.tsx`)

Maps the session's six states to the three-state ToolShell (`idle`/`selected`, `processing`, `result`, `error`):

- **Selection:** single-file FilePicker with `.docx` accept, server-processing disclosure, file size display.
- **Processing:** upload progress percentage during upload, "converting" message during conversion, cancel button.
- **Result:** download link (`word-to-pdf.pdf`), file size, "server copy has been deleted" confirmation, start-over button.
- **Error:** error copy from the session's vocabulary, file stays selected for retry.

### 7. Route page (`app/word-to-pdf/page.tsx`)

Follows the `merge-pdf` pattern exactly: static tool lookup, metadata export, related-tools sidebar.

### 8. Retention policy

The effective retention policy for M4C:

1. **Normal flow (client calls DELETE):** The session calls `deleteJob` immediately after downloading the PDF blob. Server workspace lifetime is typically under 30 seconds.
2. **Abandoned flow (janitor):** The janitor sweeps workspaces older than `job_lifetime_seconds` (default 15 minutes). This handles browser crashes, lost connections and users who navigate away during conversion.
3. **No persistent storage:** The in-memory job store from M4A is unchanged. A process restart clears all jobs. Workspaces on disk are ephemeral and cleaned by the janitor.

This satisfies FR-PRV-003 (automatic deletion), FR-PRV-004 (immediate cleanup after completion), and the Security Architecture §9 guidance ("no more than 60 minutes, with normal jobs deleted much earlier").

### 9. Test updates

- **tool-registry.test.ts:** Updated available-tools list, limits assertions, and getToolHref expectations to include word-to-pdf.
- **shared-ui.test.tsx:** Added SERVER+available disclosure test ("Secure server processing").
- **shell.spec.ts:** Added /word-to-pdf to routes, file-picker checks, and screenshot list; removed from 404 expectations.
- **word-to-pdf-session.test.ts:** 15 unit tests covering selection, validation, full conversion flow, error handling, cancellation, reset, dispose, and helper functions.
- **word-to-pdf.spec.ts:** 5 E2E tests with Playwright route interception mocking the processor API: page structure, full conversion flow, privacy disclosure, client-side rejection, and start-over reset.

## Non-goals of M4C

- **No benchmark results.** The benchmark harness methodology was documented in M4B. Actual numbers and tuned limits come from a dedicated benchmark run before any public rollout.
- **No retention-time change.** The 15-minute janitor default stands; the Product Owner can adjust it after benchmark evidence. _Update 2026-10-22: changed to 10 minutes by [ADR-032](032-abandoned-job-retention.md)._
- **No concurrent conversion limits in the UI.** The processor's `max_inflight_jobs` (32) enforces server-side; the UI is single-file-at-a-time by design.
- **No PDF-to-Word activation.** That remains planned.

## Consequences

- Users can convert DOCX files to PDF through the web application for the first time.
- The privacy disclosure clearly communicates server processing before any upload occurs.
- Server artifacts have a measured, documented retention: seconds in normal flow, 15 minutes maximum via the janitor safety net.
- The external-store pattern from MergeSession proved reusable for server-processed tools with minimal adaptation.
- The Next.js proxy pattern avoids CORS complexity and keeps the processor origin configurable via environment variable.
- LOCAL tools and their privacy guarantees remain completely unchanged.

## Links

- Governance: `docs/12_Claude_Engineering_Handoff_Governance.md` §9.
- M4B foundation: `docs/adr/022-m4b-libreoffice-adapter.md`.
- SRS requirements: FR-W2P-001, FR-W2P-002, FR-W2P-003, FR-PRV-003, FR-PRV-004, FR-PRV-008.
- UX Spec: §8 (Privacy Indicator), §9 (Tool-Specific UX), §10 (Processing States).
- Security Architecture: §9 (Retention Policy).
