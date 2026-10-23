# ADR-035: Bad-input matrix: one first look, honest refusals, a stricter DOCX preflight

**Status:** Implemented under the approved M7 gate; owner acceptance pending
**Date:** 2026-10-23
**Scope:** What each tool says and does when it is given a file it should refuse (empty, mislabelled, not a document, damaged, password-protected, over the limit); the one rule the ten PDF tools use for their first look at a chosen file; the Word to PDF page's wording and the processor's error codes for documents it cannot take or cannot convert; the DOCX preflight's scan of XML parts; the processor's answer to a malformed request; and the browser test that gives every tool every kind of bad file. No change to what a tool produces for a good file, to any limit, or to where a file is processed. One behaviour does change: three tools now apply the name and type rule the other seven already applied (decision 1).
**Relates to:** document 05 section 6 (upload and preflight controls: extension and MIME are hints, the server checks content) and section 18 (file-validation tests), document 08 section 4 (the bad-input fixture list), ADR-022 (DOCX validator), ADR-024 (limits), ADR-033 (processor abuse controls), ADR-034 (security headers), governance section 14.3.

## Context

Documents 05 and 08 list the files every tool has to survive: corrupt, truncated and password-protected PDFs, malformed DOCX and ZIP files, zero-byte and wrong-extension files, files that lie about their type, files built to expand enormously, and hostile names. Until now these were tested one tool at a time, where someone thought of them. M7D runs all of them against all twelve tools, in a browser, and fixes what that shows.

Before fixing anything I measured what a person sees today. The measurements (twelve tools, thirteen kinds of bad PDF; the Word page and the processor with the real converter) found four kinds of problem:

1. **The wrong reason.** For an empty file, a file named `.txt` and a file declared as an image, the PDF tools gave a message about limits, or "could not be opened" with no cause, and Compress said the file exceeded its size limit. None of those is about a limit.
2. **A document's fault shown as the server's.** When LibreOffice could not read a document (a package that passes the preflight but holds unreadable XML) it exits with a success code, writes nothing, and prints "source file could not be loaded". The processor treated "no PDF written" as its own failure (`internal`, HTTP 500), and the page told the person "the processing server is not available, try again in a moment". Trying again cannot help, and the person was told the wrong thing.
3. **A gap in the DOCX preflight.** The check for a DTD or entity declaration looked at three small parts (`[Content_Types].xml`, `_rels/.rels`, `word/_rels/document.xml.rels`) and never at `word/document.xml` or any other part. A main document with a DOCTYPE, an entity bomb or an external entity passed the preflight. I put each of those three through the preflight as it was on `main` and then the real converter (LibreOffice 24.2.7.2): all three passed the preflight; the converter wrote no PDF for the entity bomb or for the external entity, and converted the plain DOCTYPE with an external DTD address; each run took under two seconds and about 216 MB. So the converter and its limits held, and the preflight was missing a second guard it was meant to have. It was not a live hole.
4. **The framework's answer to a malformed request.** A request to create a job with a body that is not the expected shape got FastAPI's default 422 reply, which lists the offending field and echoes what was sent. Every other processor reply uses a small fixed vocabulary that repeats nothing.

## Decisions

**1. One first look for every PDF tool.** `validatePdfCandidate` (in `packages/pdf-browser`) already existed for Merge. All ten PDF tools now call it first, before reading a byte (Split, Rotate, Extract, Delete, Organize, PDF to JPG, PDF to Text, Remove Metadata, Compress, Merge). It uses only what the browser reports, in this order:

| Order | Refusal            | When                                                                                                                |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1     | `EMPTY_INPUT`      | the file has no bytes                                                                                               |
| 2     | `UNSUPPORTED_TYPE` | the name does not end in `.pdf`, or the declared type is not empty, `application/pdf` or `application/octet-stream` |
| 3     | `INPUT_LIMIT`      | the file is over this tool's size limit (the limit differs by tool)                                                 |

Seven of the ten tools (the five page tools, PDF to JPG and Merge) already refused a file by exactly this name and type rule, but each reported it as a limit. Compress, PDF to Text and Remove Metadata did not: they opened any file by its content. They now apply the same rule, so a real PDF named `report` or `report.txt` is refused by all ten the same way. That is a change in behaviour for those three, and the rule was chosen over the opposite (accept any name when the content is a PDF) because it is the one the product already had, the file pickers already offer only `.pdf`, and one rule is easier to explain and to test than two. What is inside the file is decided later, by the tool that opens it, as before. The name and type are hints and the content is the check (document 05 section 9); they are used only to give a cause that is certain. A file with no declared type is accepted, because some browsers and operating systems report none. The order is empty, then name and type, then size, so a zero-byte `a.txt` is called empty and a large `a.txt` is called the wrong kind of file, whichever the person would fix first. A single function means one change if a real device shows the rule is wrong (limit 2 below).

**2. Each cause gets its own words.** `EMPTY_INPUT` says the file is empty. `UNSUPPORTED_TYPE` says the file is not a supported PDF and that its name has to end in `.pdf`. Neither mentions a limit, and a unit test checks that. The wording is in one file (`apps/web/lib/pdf-input-copy.ts`) shared by every tool except Merge, which keeps longer wording of its own because it shows a list and tells the person to remove the row.

**3. "The converter could not read it" is the document's fault.** The processor has a new error code, `conversion_failed` (HTTP 422, message "The document could not be converted."), for two cases: the converter exits with a failure code, and the converter exits cleanly and writes no PDF. A converter ended by a signal (out of memory, a crash) is still `internal`, because that is the service failing. The Word page maps `conversion_failed` to its existing "could not finish; the document may be damaged, password-protected or contain unsupported features" wording, which does not say to try again. `internal` and network failures still say the server is not available.

**4. One server refusal, one honest page message.** The processor answers `invalid_input` for every reason it will not take a document (not a real `.docx`, an old `.doc` renamed, password-protected, macros, built to expand) and by design does not say which, so a probe learns nothing. The page now says exactly that: "This document could not be accepted. It may be damaged, password-protected, macro-enabled, or an older .doc file renamed to .docx." It was "this file is not a supported DOCX", which was wrong for a password-protected file. An empty `.docx` is refused on the device as empty, not as unsupported.

**5. Every XML part is scanned for DTDs, and must be UTF-8.** Any part whose name ends in `.xml` or `.rels` is checked for `<!doctype` and `<!entity` (compared in lower case). The scan runs inside the counting inflate the validator already does for the expansion limits, so no part is inflated twice and the scan sees the bytes that were actually counted. A marker split across two read chunks is found by carrying the last bytes of one chunk into the next. A byte scan only means something for text it can read, so an XML part that starts with a UTF-16 or UTF-32 mark, has a NUL in its first bytes, does not start with `<`, or declares an encoding other than UTF-8 is refused. Without that rule, re-encoding the main document as UTF-16 would hide a DOCTYPE from the scan.

**6. A malformed request gets the same fixed answer.** The processor now handles the framework's validation error itself: HTTP 400, code `invalid_input`, the usual message, nothing echoed. A test compares the whole body.

**7. The matrix is a standing test.** `apps/web/e2e/bad-input-matrix.spec.ts` runs in every browser project. Each PDF tool gets thirteen bad PDFs and one over the size limit; Images to PDF gets nine bad images; the Word page gets its on-device rules and seven server verdicts with a scripted processor, and one recovery. For each case the test says what must be true: an alert names the real cause, wording for a different cause is not used, nothing is offered for download, nothing leaves the browser and nothing throws (the audited `test` fixture), and a good file chosen next works without reloading. The cases are listed in the spec, not here, so the two cannot drift.

## Why not more

- **Check the file's contents on the device before the tool opens it.** The tools already do, with PDF.js and pdf-lib, and report damaged, encrypted and unsupported files. A second reader would be one more thing to disagree with the first.
- **Refuse by file name alone, with no declared-type check.** Rejected: a PDF declared as an image is a signal worth refusing before any parsing, and the type list is short and includes the empty value.
- **Accept a name with no `.pdf` ending if the content is a PDF.** Deferred, not rejected; see item 2 below.
- **Tell the person on the Word page why the server refused.** Not possible by design (decision 4). The server's single answer is deliberate, so a probe learns nothing, and the page says what it can honestly say.
- **Parse the XML in the preflight.** More code in the part of the service that sees untrusted bytes first. A byte scan plus an encoding rule is smaller and was enough to close the gap.

## What changed

- `packages/pdf-browser/src/{validation,page-errors}.ts`: the shared rule and its two refusal codes.
- `apps/web/lib/pdf-input-copy.ts`: the two shared messages. Each tool's copy map includes them: `components/page-tools/copy.ts`, `components/organize/organize-workspace.tsx`, `components/pdf-to-text/session.ts`, `components/remove-pdf-metadata/session.ts`, `components/compress-pdf/session.ts`.
- `apps/web/components/{pdf-preview,compress-pdf,pdf-to-text,remove-pdf-metadata}/*session.ts`: call the rule first.
- `apps/web/components/word-to-pdf/session.ts`: empty and invalid-document codes and wording; `conversion_failed` mapped.
- `services/processor/app/errors.py`, `app/jobs/engines/libreoffice.py`: `conversion_failed`, and the signal / exit-code / no-output rules.
- `services/processor/app/jobs/validators/docx.py`: the scan and the UTF-8 rule (replaces the three-part check).
- `services/processor/app/main.py`: the validation-error handler.
- Tests: see Evidence.

## Evidence

- **Processor:** 248 pass, 1 skipped (the skip is an existing one: the zip library strips a NUL byte the test needs). Ruff, format and mypy are clean. New tests: the scan in every XML part and in `.rels`; a marker split at a chunk boundary; upper-case and mixed-case markers; UTF-16, UTF-32, a byte-order mark, a declared Latin-1 encoding; the expansion controls with the scan in the same loop; who is at fault for each converter outcome (exit code, no output, killed by a signal) with a stand-in converter; the real converter on documents it cannot load (422); a not-a-document matrix and hostile file and tool names through the API; the declared type and file name having no effect; malformed request bodies (exact reply body compared).
- **Web unit tests:** 420 pass (391 before). New: the shared rule case by case and in order, one wording shared by all tools and free of limit words, PDF to Text refusing before it opens the file, and per-tool session tests for empty, mislabelled and over-limit files.
- **Browser matrix:** 20 tests in each browser project, 163 cases: one test for each of the ten PDF tools (fourteen cases each), one for Images to PDF (nine bad images and a recovery), and nine for the Word page.
- **The tests can fail.** I weakened the processor changes eleven ways, one at a time: the converter exit code treated as the service's fault; no-output treated as the service's fault; a signal treated as the document's fault; `.rels` not scanned; `.xml` not scanned; no overlap between chunks; case-sensitive markers; the entity marker dropped; the DOCTYPE marker dropped; the UTF-8 rule skipped; the malformed-request handler removed. Each was caught by at least one test, and each of those tests is named for what it protects.
- **Browser mutations and five-browser CI:** see the milestone report.

## Not covered, and limits

1. **Password-protected PDFs in this environment.** The local Chromium (141) makes PDF.js report encrypted files as unreadable, so the password cases fail locally on `main` and on this branch alike (the same encrypted-PDF tests that fail on `main`). CI decides them.
2. **A PDF with no `.pdf` name.** Some phone file pickers hand over a file with a generic name or no extension. The rule refuses it and says why. Whether real Android and iOS pickers do this for ordinary PDFs is a device question for M7G; if they do, the change is in the one function.
3. **A legal but rare DOCX.** The Open Packaging Conventions allow UTF-16 for XML parts. Word and LibreOffice write UTF-8. A UTF-16 package is refused with the general "could not be accepted" message.
4. **A server-made PDF that fails the processor's own output check** is still reported as `internal`, so the page says the server is not available. It is not a fault of the person's document in the usual case and is not changed here.
5. **A dropped connection during upload reads as "server not available".** The page cannot tell a dead network from a dead server and says what covers both. Unchanged.
6. **No real Safari, Firefox, phones or screen readers** (M7G).
