# ADR-038: A tool whose code cannot load says so: one error for "the connection dropped", not a verdict on the document

**Status:** Implemented under the approved M7 gate; owner acceptance pending
**Date:** 2026-11-04
**Scope:** What a person is told when the code a tool needs cannot be fetched (a connection that drops after the page has loaded and before, or while, the tool starts). One new error, `ENGINE_LOAD_FAILED`, one helper for dynamic imports, one rule for workers that never start, and the matching words in every tool. No change to what any tool produces, to any limit, or to where a file is processed.
**Relates to:** M7G finding 1 (a dropped connection is blamed on the file), NFR-PERF-003 (large libraries load on demand, which is why the code is fetched late), ADR-035 (honest wording for the cause of a refusal), ADR-036 (the error areas are announced to assistive technology), ADR-037 (the PDF libraries are fetched when the first file is chosen).

## Context

The tools fetch their code late on purpose: PDF.js, pdf-lib and the zip library are not in the first load (ADR-037), and each worker's script is fetched when the work starts. That makes a new failure possible. A visitor opens a page, the signal drops, and they choose a file: the code cannot be fetched. M7G reproduced this and found the tools blaming the file. Merge, Images to PDF and Remove PDF Metadata already had a connection message for one of their loading steps; the rest did not, and several steps in the tools that did have it were not covered. Running every tool with its code cut off, before changing anything, gave:

- Split, Organize, Extract, Delete, Rotate and PDF to JPG: "This PDF could not be opened… Choose another PDF" (the open failed with a bare error that was filed as a preview failure).
- PDF to Text and Remove PDF Metadata: "Try another PDF or try again later".
- Compress, when only its worker's script was cut off: "It may be too large for this device's memory. Try a smaller PDF or another browser." That is not just unhelpful; it sends a person with a good file to the wrong remedy.
- Any tool whose PDF.js worker never started: no message at all. PDF.js waits for its worker without end, and tearing the open down also waited for the worker to answer, so the page stayed on "Opening your PDF" until the person left.

A good file thrown away on a weak signal is the most likely real-world complaint about the product, so it is fixed before launch.

## Decisions

**1. One error, `ENGINE_LOAD_FAILED`, in the page-error vocabulary** (`PageErrorCode`), and in the merge and image vocabularies, which are separate types. It means only "the tool's own code could not be fetched". It carries no cause (no URL, no message), like every other error in the package.

**2. Dynamic imports go through `loadEngineModule(() => import(...))`.** A rejected import becomes `ENGINE_LOAD_FAILED`. It wraps every import of tool code: the web app's imports of each tool's module (the page tools, PDF to Text) and the library's own imports of PDF.js, pdf-lib and the zip library. `stream-repair` keeps its existing behaviour of carrying on without repair if its zip chunk is missing; that is a quality step, not the work.

**3. A worker that fails before it has sent a message never started.** Each worker client (merge, page operations, split, compress, images to PDF) records whether the worker has spoken. An `error` event before the first message is `ENGINE_LOAD_FAILED`; after it, the work failed and the old code stands. The preview worker (PDF.js) gets the same rule through its own listener, and the open no longer waits for a worker that cannot answer: the open and its teardown both end when the worker reports it failed to start.

I chose "has it spoken" over reading the error event. The shape of that event depends on what failed (the worker's script itself, or the chunks the worker fetches after it starts, which fail with an error that carries text) and may differ between browsers, and I can run only Chromium here. Whether the worker has sent anything is the same everywhere. The cost is that a worker that crashes before its very first message is also worded as a connection problem; that is rare, the words ("try again") remain a fair remedy, and the old wording for it was no more accurate.

**4. The words.** Every tool's table gets `ENGINE_LOAD_FAILED` with the sentence already used by Merge, Images to PDF, Remove PDF Metadata and PDF to Text: "The local PDF engine could not load. Check your connection and try again." A test requires every table's sentence to name the connection and say to try again, and to contain nothing about the file. The page tools also speak a short matching announcement when the open fails this way. The error headings that already existed ("This PDF could not be opened") are unchanged: they say what did not happen, and the sentence beneath says why.

## Consequences

- No tool produces a different file. Nothing about processing location changes: the code is still fetched from the site's own origin, and no document byte goes anywhere.
- After the connection returns, the same page works without a reload (tested for every tool).
- The error area is announced as before. The sentence is one line, shorter than the other refusals.
- The "has it spoken" rule can only change a message from "the work failed" to "the connection failed" for a worker that said nothing. It cannot turn a success into a failure.

## Verification

- `packages/pdf-browser/tests/engine-load.test.ts` (new): the helper; the PDF.js, pdf-lib and zip imports each failing; a preview worker that never starts, silent and after speaking, including that its teardown does not hang (the test times out without the fix).
- The four worker client tests (page operations, split, compress, merge) each gain a silent-worker case; the existing "worker crashed" cases now send a message first, which is what they always meant.
- `apps/web/tests/engine-load-failure.test.ts` (new): the page-tool and PDF to Text sessions against a module that cannot load; every tool's sentence.
- `apps/web/e2e/load-failure.spec.ts` (new): in a real browser, for every tool that loads code or starts a worker, cut the code (every script not already fetched) or the workers (every worker pointed at a missing script), choose a good file, and require the connection words and nothing that blames the file; then restore the connection and finish the job on the same page. Also the export worker of Organize and Split, started after the PDF opened.

## Not done

- A worker that crashes without ever speaking, while the connection is fine, is worded as a connection problem (decision 3).
- The pages' own HTML and first scripts are not covered: if they cannot load there is no page to say anything. A service worker could cache the tools for offline use; that is a product decision and is not proposed here.
- The retry is "choose the file again" on the same page; there is no retry button that keeps the file. The wording says to try again, which is true.
