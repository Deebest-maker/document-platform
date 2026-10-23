# M7D Milestone Report: Bad-input matrix

**Date:** 2026-10-23
**Status:** Implemented; owner acceptance pending
**Preceding slice:** M7C — web security headers and CSP (accepted and merged, `03b4186`; main's CI on that commit passed in all five browsers).
**Part of:** M7 QA and hardening (governance §14.3), slice D of seven.
**Decision record:** [ADR-035](../adr/035-m7d-bad-input-matrix.md).

## Summary

Every tool was given every kind of file it should refuse, the way a person would give it: through the file picker, in a browser. Before fixing anything I measured what each tool said. Four kinds of problem turned up and are fixed. After the fixes the same test is part of the suite, so a tool that starts giving the wrong answer fails the build.

Nothing changes for a good file. For a bad one, the person is now told what is actually wrong, and the Word to PDF server's own mistakes are no longer blamed on the person's document or the other way round.

## What I found, and what changed

1. **The wrong reason.** An empty file, a file named `.txt` and a file declared as an image were met with a message about limits, with "could not be opened" and no cause, or (Compress) with "exceeds the size limit". The ten PDF tools now share one first look at a chosen file, with one wording: _"This file is empty"_, _"This file is not a supported PDF… name ends in .pdf"_, or the size limit. A test checks that neither of the first two mentions a limit.
2. **A document's fault shown as the server's.** When LibreOffice cannot read a document it exits normally and writes nothing. The processor took that for its own failure and the page said "the processing server is not available, try again". Now the processor answers `conversion_failed` (a new code, HTTP 422) and the page says the document may be damaged, password-protected or unsupported. A converter killed by the system (out of memory, a crash) is still a server fault.
3. **A gap in the DOCX preflight.** The check for a DOCTYPE or entity declaration looked at three small parts of the package and never at the main document. I put an entity bomb, an external entity and a plain DOCTYPE in the main document: all passed the preflight on `main`. The real converter handled them (LibreOffice 24.2.7.2: it refused two, converted the third, under two seconds and about 216 MB each), so this was a missing second guard, not a live hole. Every `.xml` and `.rels` part is now scanned while it is inflated, with no second pass, and must be UTF-8, because a byte scan cannot see a marker in UTF-16.
4. **The framework's answer to a malformed request** listed the offending field and echoed what was sent. It now gets the processor's usual fixed error and repeats nothing.

Also: the Word page now says an empty `.docx` is empty (it said "not supported"), and when the server refuses a document it says "could not be accepted… damaged, password-protected, macro-enabled, or an older .doc renamed to .docx". The server deliberately does not say which, and the page no longer claims it was not a DOCX.

## Verification

- **Processor:** 248 pass, 1 skipped (existing skip). Ruff, format and mypy clean. New tests cover the scan in every XML part, a marker split across a read boundary, case, encodings, the converter's three outcomes, the real converter on unreadable documents, the not-a-document matrix, hostile file and tool names, and malformed bodies.
- **Web unit tests:** 420 pass (391 before). Lint, types, format and the production build pass.
- **The browser matrix:** 20 tests in each browser project, 163 cases. For each case the test requires: a visible message naming the real cause, no wording for a different cause, nothing to download, nothing sent off the device and no errors in the page (the existing audited fixture), and a good file working afterwards without a reload.
  - Ten PDF tools × thirteen bad PDFs (zero bytes, plain text, a web page with a script, a PNG, a header with no body, truncated, corrupt, no pages, password-protected, a real PDF named `.txt`, with no extension, named `.pdf.exe`, declared as an image) plus a file over the limit, plus recovery.
  - Images to PDF × nine bad images (empty; text, a PDF and a script-carrying vector image named as JPEG or PNG; a JPEG header alone; a truncated PNG; a GIF; a PNG named `.jpg`; no extension) plus recovery.
  - Word to PDF: five refused on the device (empty, `.doc`, a PDF, no extension, `.docx.exe`) and an oversized file, with nothing sent to the server; seven scripted server answers (invalid input, conversion failed, too large when converting and when uploading, a dropped connection, a server fault, too many conversions), each checked for its words and for the job being deleted afterwards; and a good document converting after a refused one.
- **Full desktop and phone Chromium run, local:** 368 pass, 30 fail. The 30 are the same 8 tests per project that fail on unmodified `main` here (this environment runs Node 22 and a Chromium that reports encrypted PDFs as unreadable) plus the new password-protected case on seven tools per project, which fails for the same reason. CI is authoritative for them. No other test changed result.
- **The tests can fail.** I weakened the processor changes eleven ways, one at a time (converter exit code, no output and signal each mapped the wrong way; each XML suffix; the chunk overlap; marker case; each marker; the UTF-8 rule; the request handler). Every one was caught by a test named for what it protects. In the browser I changed the empty-file wording to a limit message (caught on nine tools, the tenth is Merge, which has its own wording), put back the old Word mapping of the server's refusal (caught), and removed the shared rule from Compress and Remove Metadata (caught in both). Each was restored and the matrix re-run to confirm the baseline.
- **Five-browser CI on the code commit (`1f1f913`):** desktop and phone Chromium, Firefox, WebKit and phone WebKit all pass, with the processor tests, the processor container build and the web quality job. This includes the password-protected cases on all ten tools that could not run here, so the wording they expect is confirmed. The report commit after it changes only this file.
- **Not verified:** real Safari, real Firefox and phones (M7G); the password-protected cases locally (they pass on CI); behaviour of the Word page with a real processor behind a real proxy (M8). The server's side is tested with the real converter in the processor tests, and the page's side with a scripted server.

## Behaviour change to be aware of

Compress, PDF to Text and Remove Metadata used to open any file by its content, whatever it was called. They now refuse a file whose name does not end in `.pdf` or whose declared type is not a PDF type, as the other seven already did. A real PDF named `report` or `report.txt` is therefore refused by all ten, with a message that says why. I chose the rule the product already had over the opposite one (accept any name if the content is a PDF) so there is one rule to explain and test, and the file pickers already offer only `.pdf`. If real phones turn out to hand over PDFs with no extension, it is a one-function change (see Known limitations).

## Known limitations

1. **Phones and the file name.** Some Android pickers may deliver a PDF with a generic name or no extension. Not measurable here; added to the M7G device checklist.
2. **The password-protected cases cannot pass in this environment** (above). They pass on CI in all five browsers.
3. **A legal but rare UTF-16 DOCX** is refused with the general "could not be accepted" message.
4. **A PDF the converter produced that the processor's own output check refuses** is still reported as a server fault.
5. **A dropped connection during an upload** reads as "server not available", because the page cannot tell it from a down server.
6. **Real Safari, Firefox, phones and screen readers** are M7G.

## Deviations from plan

- The plan listed the matrix as tests. It also changed code, because the measurements showed four real problems. The code changes are small and each has its own tests.
- A first version of my matrix read the whole workspace as "the message" on Merge and Word, because those two wrap the page in the alert. That produced false failures from the page's fixed "limits" text. The test now reads the message element. Two other expectations I had wrong were about existing, deliberate behaviour (a refused image stays in the list until removed; a dropped connection reads as "server not available") and were corrected in the test, not in the page.

## Decisions

1. **M7D accepted** — for you to say. I will not merge until you do.
2. **Name and type rule for all ten PDF tools** (above). Engineering call; say if you want the opposite.
3. **Open for the M7G checklist:** PDFs with no extension from real phones.
4. **Branches.** The 21 throwaway `check/` branches from M7C are still on GitHub; deleting them is not possible from this session.

## Recommended next

**M7E — accessibility.** Keyboard, focus, screen-reader names and contrast across every tool and every state, including the new error messages. I will not start it until you say so.

## Files

- Shared rule and wording: `packages/pdf-browser/src/{validation,page-errors}.ts`, `apps/web/lib/pdf-input-copy.ts`.
- Tool sessions and copy: `apps/web/components/{pdf-preview,compress-pdf,pdf-to-text,remove-pdf-metadata,word-to-pdf,page-tools,organize}/…`.
- Processor: `services/processor/app/{errors.py,main.py}`, `app/jobs/engines/libreoffice.py`, `app/jobs/validators/docx.py`.
- Tests: `apps/web/e2e/bad-input-matrix.spec.ts`, `apps/web/tests/pdf-input-refusal.test.ts` and the session tests, `services/processor/tests/jobs/{test_bad_input_api,test_docx_validator,test_libreoffice_engine,helpers}.py`.
