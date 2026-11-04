# M7H Milestone Report: A dropped connection is no longer blamed on the file

**Date:** 2026-11-04
**Status:** Implemented; owner acceptance pending
**Preceding slice:** M7G — device checklist (accepted 2026-11-04 and merged, `2f0c8bd`; its record merged as `e1dc92d`).
**Part of:** M7 QA and hardening (governance §14.3), follow-up to M7G finding 1, taken up on the Product Owner's go-ahead.
**Decision record:** [ADR-038](../adr/038-m7h-load-failure-wording.md).

## Summary

When the signal drops after a page has loaded and before (or while) a tool starts, every PDF tool now says "The local PDF engine could not load. Check your connection and try again." It used to say the file was the problem ("Choose another PDF"), say nothing at all, or, for Compress, say the file may be "too large for this device's memory". The same page works again once the connection returns, without a reload. Nothing a tool produces has changed.

## What I found, and what changed

1. **Cutting the code off in a real browser, before changing anything, gave five different wrong answers.** The six page tools said "could not be opened… Choose another PDF". PDF to Text and Remove Metadata said "try another PDF or try again later". Compress said "too large for this device's memory". Merge and Images to PDF already said the right thing for one loading step.
2. **A second case the M7G finding had not named: the worker's script.** Compress, Split, Organize and the other tools do their work in a background worker whose script is fetched when the work starts. With that cut off, they blamed the file (or its size). **Fixed:** a worker that fails before it has sent a single message never started; that is now the connection message. A worker that fails after it has spoken keeps the old wording.
3. **A third case, found by testing it: the page hung.** If the PDF.js worker never started, PDF.js waited for it for ever, and tearing the open down waited for the dead worker to answer, so the page sat on "Opening your PDF" with no message. **Fixed:** the open ends with the connection message.
4. **One new error, one helper.** `ENGINE_LOAD_FAILED` is added to the error vocabularies; `loadEngineModule` wraps each dynamic import of tool code (PDF.js, pdf-lib, the zip library, each tool's module). The four tool tables that lacked the sentence got it; the sentence is the one Merge, Images to PDF, Remove Metadata and PDF to Text already used.

## Verification

- **In a real browser, per tool (new, `apps/web/e2e/load-failure.spec.ts`, 23 tests per browser project):** all eleven tools with their code cut off (every script not already fetched), ten with their workers cut off (every worker pointed at a missing script), and the export workers of Organize and Split after the PDF had opened. Each must show the connection words and nothing that blames the file, then finish the same job on the same page once the connection is back. 23 of 23 pass in Chromium here.
- **Shown to fail when the property breaks:** with the error code swapped back for a generic one, the chunk tests fail; with the teardown wait restored, the stuck-worker unit test times out; the first run of the worker tests showed the Compress "memory" wording and the hang before the fix.
- **Unit tests (new):** 315 library (up from 303) and 423 web (up from 420) pass; type check, lint and format check pass. The four worker-client tests that fired "worker crashed" now send a message first, which is what they always meant; each gained a silent-worker case.
- **Five browsers:** I could run only Chromium here, so I ran the full workflow on the branch (all nine jobs, including Firefox, WebKit and phone WebKit, which include the 23 new tests): green.

## Known limitations

- A worker that crashes without ever sending a message, on a good connection, is worded as a connection problem. Rare, and "try again" is still a fair remedy.
- If the page's own HTML or first scripts cannot load there is no page to say anything. Keeping the tools available offline would be a service worker: a product decision, not proposed here.
- There is no retry button that keeps your file; you choose the file again on the same page.

## Deviations from documentation

None. No requirement changes; NFR-PERF-003 (libraries load on demand) is the reason the situation exists.

## Security and privacy

No document byte goes anywhere new: all code is fetched from the site's own origin as before. The new error carries no URL or message. The new browser tests run under the same audit as every other test (no third-party request, no upload, no console error, no policy refusal).

## Files

- `packages/pdf-browser/src`: `page-errors.ts` (code and helper), `preview/index.ts`, `metadata-removal.ts`, `split-operations.ts`, `pdf-to-jpg.ts` (wrapped imports and the preview worker rule), `worker-client.ts`, `page-operation-client.ts`, `split-client.ts`, `compress-client.ts`, `images-to-pdf-client.ts` (worker rule), `types.ts`, `image-types.ts` (code), `page-operation-client.ts` (export).
- `apps/web/components`: `pdf-preview/preview-session.ts`, `pdf-to-text/session.ts`, `page-tools/copy.ts`, `organize/organize-workspace.tsx`, `compress-pdf/session.ts`.
- Tests: `packages/pdf-browser/tests/engine-load.test.ts` (new) and four worker tests; `apps/web/tests/engine-load-failure.test.ts` (new); `apps/web/e2e/load-failure.spec.ts` (new).
- Records: ADR-038, this report, the ADR index, the M7 report and the governance M7 row.

## Decisions for you

1. **Accept M7H.** I will not merge until you do.
2. **Recommended next:** the requirement-to-test table (M7G finding 4), a documentation-and-script slice with no product change, then M8 once you have the production domain, brand name, author line and a hosting budget.
