# M4C Milestone Report: Product Slice & Retention Policy

**Date:** 2026-10-17
**Status:** Implementation complete; awaiting Product Owner acceptance.
**Preceding milestone:** M4B — LibreOffice Adapter & Container (merged PR #15).

## What was implemented

M4C activates the Word-to-PDF conversion tool in the web application. This is the first server-processed tool to go live, establishing the patterns for upload progress, server-side conversion status, privacy disclosure, and server resource cleanup.

### 1. Registry & privacy (packages/tool-registry)

- `word-to-pdf` moved from `planned` to `available` with `featured: true`.
- Limits set to match processor config: 1 file, 20 MiB input, 32 MiB output.
- New `SERVER + available` privacy presentation: "Secure server processing" with explanation about encrypted upload and automatic deletion.
- All existing LOCAL privacy wording unchanged.

### 2. Next.js API proxy (apps/web)

- Added rewrite rule: `/api/processor/:path*` → `${PROCESSOR_ORIGIN}/v1/:path*`.
- Defaults to `http://localhost:8000`; configurable via `PROCESSOR_ORIGIN` env var.
- Eliminates the need for CORS configuration between browser and processor.

### 3. Processor API client (apps/web/components/word-to-pdf/api.ts)

- Typed client for create, upload (XHR with progress), convert, download, delete.
- Upload uses `XMLHttpRequest` because `fetch` does not support upload progress events.
- Capability token held in memory only; never persisted.
- All calls go through the Next.js proxy path.

### 4. WordToPdfSession (apps/web/components/word-to-pdf/session.ts)

- External store pattern matching `MergeSession`: subscribe/getSnapshot for `useSyncExternalStore`.
- States: idle → selected → uploading → converting → result | error.
- Client-side validation: extension check, empty-file check, size-limit check.
- Generation tracking and AbortController for safe cancellation.
- Server cleanup: `deleteJob` called after download or on error.
- pagehide listener for cleanup on navigation.

### 5. Workspace UI (apps/web/components/word-to-pdf/word-to-pdf-workspace.tsx)

- Single-file FilePicker with `.docx` accept.
- Upload progress percentage display.
- "Converting to PDF" status during conversion.
- Download link with output size; "server copy has been deleted" confirmation.
- Cancel button during processing; start-over button on result and selection.
- Privacy disclosure visible before any interaction.

### 6. Route page (apps/web/app/word-to-pdf/page.tsx)

- Follows merge-pdf pattern: static tool lookup, metadata, related-tools sidebar.
- `robots: { index: false, follow: false }` for pre-launch.

## Architecture/technical decisions

| Decision                                        | Rationale                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Next.js rewrites proxy instead of CORS          | Keeps processor origin out of client code; single config point; avoids preflight requests.                                    |
| XHR for upload instead of fetch                 | fetch does not support upload progress events. XHR is the only browser API that provides them.                                |
| Fire-and-forget deleteJob                       | Client calls DELETE after download. Network failure is acceptable — the janitor is the safety net.                            |
| maxPages: 0 in registry                         | Server tools don't do client-side page counting. The processor's own output validation handles page-count sanity.             |
| Generation tracking (not AbortController alone) | Prevents stale promise callbacks from corrupting session state after cancellation, matching the proven MergeSession approach. |

## Files added or materially changed

### Added

- `apps/web/components/word-to-pdf/api.ts` — Processor API client
- `apps/web/components/word-to-pdf/session.ts` — WordToPdfSession external store
- `apps/web/components/word-to-pdf/word-to-pdf-workspace.tsx` — Workspace UI
- `apps/web/app/word-to-pdf/page.tsx` — Route page
- `apps/web/tests/word-to-pdf-session.test.ts` — 15 unit tests
- `apps/web/e2e/word-to-pdf.spec.ts` — 5 E2E tests
- `docs/adr/023-m4c-product-slice-retention.md` — Architecture decision record
- `docs/reports/M4C-milestone-report.md` — This report

### Changed

- `packages/tool-registry/src/catalog.ts` — word-to-pdf → available + limits
- `packages/tool-registry/src/privacy.ts` — SERVER+available presentation
- `apps/web/next.config.ts` — API proxy rewrites
- `apps/web/tests/tool-registry.test.ts` — Updated for word-to-pdf activation
- `apps/web/tests/shared-ui.test.tsx` — Added SERVER+available test
- `apps/web/e2e/shell.spec.ts` — Added word-to-pdf to routes/assertions

## Tests and results

### Unit tests (word-to-pdf-session.test.ts)

- 15 tests covering: idle state, file selection, DOCX validation (extension, empty, size), full conversion flow (create → upload → convert → download → delete), listener notification, unsubscribe, error handling (createJob, upload, convert, download failures), cancellation, reset, dispose, canConvert logic, displayName helper, formatBytes helper.

### Updated unit tests

- tool-registry.test.ts: available tools list updated, word-to-pdf limits verified, href routing, SERVER+available privacy label.
- shared-ui.test.tsx: SERVER+available disclosure rendering.

### E2E tests (word-to-pdf.spec.ts)

- 5 tests with Playwright route interception mocking all processor API endpoints.
- Tests: page structure, full conversion flow, privacy disclosure content, client-side rejection of non-DOCX, start-over reset.

### E2E updates (shell.spec.ts)

- /word-to-pdf added to routes, file-picker checks, and screenshot captures.
- Removed from 404 test; replaced with /pdf-to-word (still planned).

## Retention policy

| Scenario                           | Retention          | Mechanism                                             |
| ---------------------------------- | ------------------ | ----------------------------------------------------- |
| Normal flow                        | ~seconds           | Client calls DELETE after download                    |
| User navigates away mid-conversion | ≤15 minutes        | Janitor sweeps expired workspaces                     |
| Browser crash during upload        | ≤15 minutes        | Janitor sweeps; partial upload in workspace           |
| Process restart                    | Immediate (memory) | In-memory store cleared; disk cleaned on next startup |

This satisfies:

- **FR-PRV-003:** Automatic deletion mechanism independent of normal flow (janitor).
- **FR-PRV-004:** Immediate cleanup after completion/failure (client-initiated DELETE).
- **FR-PRV-008:** Retention duration documented (this report, ADR-023).
- **Security Architecture §9:** "No more than 60 minutes, with normal jobs deleted much earlier" — achieved with seconds-level normal retention and 15-minute safety net.

## Known limitations

1. **No benchmark-tuned limits.** The 20 MiB / 32 MiB limits match M4A engineering defaults, not measured production values. A benchmark run against the built container will inform production tuning.
2. **No concurrent conversion progress.** The UI supports one file at a time. Multiple concurrent conversions would require session multiplexing not in scope.
3. **Layout fidelity depends on fonts.** The container ships Liberation fonts; documents using proprietary fonts will render with fallbacks. The UI discloses this.
4. **No retry on transient failure.** If conversion fails, the user must start over. Automatic retry is not implemented.

## Deviations from documentation

None. All requirements from the SRS (FR-W2P-001 through FR-W2P-003), Security Architecture §9, and UX Spec §8–§10 are satisfied as specified.

## Security/privacy considerations

- Capability tokens are held in JavaScript closures; never persisted to storage, cookies, or URLs.
- The Next.js proxy strips the processor origin from client visibility.
- Upload and download go through HTTPS (the proxy handles the last hop to the processor in production).
- Server artifacts are deleted by the client after download; the janitor is the safety net, not the primary mechanism.
- No document bytes, filenames, or metadata are logged.
- LOCAL tools are completely unaffected; no privacy regression.

## Unresolved decisions

1. **Production retention time.** The 15-minute janitor default should be validated by the Product Owner against benchmark results and download UX.
2. **Benchmark execution.** The M4B benchmark harness is documented but has not been run against the built container image.
3. **Featured placement.** word-to-pdf is marked `featured: true` pending Product Owner confirmation.

## Recommended next milestone

M4D — Benchmark execution and production tuning:

- Run the M4B benchmark harness against the built container.
- Set production-tuned limits based on measured latency, memory, and disk usage.
- Tune janitor interval and job lifetime based on benchmark evidence.
- Consider concurrent conversion if benchmarks show fast enough processing.
