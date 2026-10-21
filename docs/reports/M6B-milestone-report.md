# M6B Milestone Report: Tool-page guides

**Date:** 2026-10-22
**Status:** Implemented; pull request open; owner acceptance pending.
**Preceding milestone:** M6A — Technical SEO foundation (accepted and merged, `54b2252`).
**Decision record:** [ADR-029](../adr/029-m6b-tool-page-guides.md).

## Summary

Each of the 12 available tools now explains itself under the tool: what it does, how to use it, what to know before you trust it, and four or fewer real questions. About 3,500 words of original copy in total, written one tool at a time from the real screens and the decision records. Nothing is indexed yet (ADR-028 still governs that), so this prepares the pages for launch without exposing them.

## What was implemented

- **Guides** (`apps/web/content/tool-guides.ts`): overview, 3–5 steps, 3–6 "good to know" points and 3–4 questions per tool, 200 to 383 words each. No file limits or other registry numbers in the prose, so they cannot go out of date. No savings or speed promises.
- **`ToolGuide` component:** shows the guide and the Related tools list. All 12 pages use it, which also removed the same related-tools block that was repeated in each page.
- **Accessibility fix:** the shared tool page wrapped everything in the "related" slot as a side region labelled "Related tools". Guide text there would have been announced wrongly, so only the related list is now a labelled side region.
- **Style:** a readable text width, real list markers and spacing; no new fonts or images.

## Verification

- **24 new unit tests** keep the copy true: every available tool has a guide and PDF to Word has none; no sentence appears twice in all 3,481 words; no registry numbers, uploads or servers claimed for on-device tools; the Word to PDF guide says it uploads and deletes; every file name it mentions is one the product really creates; every button name it quotes exists in the product. I broke the copy three ways on purpose (wrong file name, reused sentence, an upload claim on a local tool) and all three were caught.
- **24 new browser checks** (12 pages, desktop and phone width): five headings in order, steps as a real list, text present in the server-rendered HTML, no sideways scroll, and an accessibility scan (WCAG 2.2 AA rules, as in the existing suite) with zero violations.
- **Full local run:** format, lint, types, 194 web tests and 275 library tests pass; production build passes. Browser suite: 264 pass and 14 fail. The 14 are the same 7 PDF recovery and image-export tests in two browser projects that also fail on unmodified main in this sandbox (Node 22 here, Node 24 required), so CI is the check that counts.
- **One regression found and fixed:** the new "About Organize PDF" and "How to use Organize PDF" headings made an existing Organize test ambiguous (it matched headings by part of the name). I tightened that one locator to the page's main heading. No product code was involved.
- **Not verified:** how the pages read to someone who has not seen the code, and Safari or Firefox rendering of the new section (it is plain text and lists).

## Finding for your decision

**Images to PDF keeps photo metadata inside the PDF.** A JPEG that needs no rotation is embedded unchanged, including its camera details and any GPS position. I confirmed this with a test photo. Remove PDF Metadata would not remove it either, because it sits inside the image. The Images to PDF guide now says this plainly. I did not change the tool.

## Known limitations

1. One author and one review pass. The copy should be read by a second person before launch.
2. English only.
3. No FAQ structured data, breadcrumbs or social images yet (M6D).
4. Trust pages (About, Privacy, Terms, Contact) are still placeholders and must be finalised before indexing is turned on.

## Deviations from plan

None.

## Decisions needed from the Product Owner

1. **Accept M6B**, so I can start M6C.
2. **Read the guides** in `apps/web/content/tool-guides.ts` and tell me what to change. I can export them to a Word file for easier reading.
3. **Photo metadata in Images to PDF:** (A) keep it and rely on the new warning, or (B, my recommendation) strip it by removing the metadata block from embedded JPEGs without re-encoding the picture. B is a small follow-up and fits the privacy promise. Reply "B" to approve.
4. **Still open:** server retention for abandoned Word to PDF jobs (A 15 min today, **B 10 min recommended**, C 5 min; reply "B" to apply); production domain and brand or author name (needed for M6D and launch).

## Recommended next: M6C — Learn hub

A `/learn` page and 8 original guides, each linking to the tools it explains. Proposed topics:

1. How to merge PDFs without uploading them
2. How to make a PDF smaller, and when you cannot
3. How to split a PDF or keep only some pages
4. How to turn photos or scans into one PDF
5. How to save PDF pages as images
6. How to copy text out of a PDF, and what to do with scans
7. What is hidden in a PDF: metadata, and what removing it does not do
8. What "processed on your device" means, and when a tool uploads a file

Same rules as M6B: no filler, no unverifiable claims, and tests that reject repeated sentences and false file names. Tell me which topics to keep, drop or add. I will not start M6C until you accept M6B.

## Files

- `apps/web/content/tool-guides.ts`, `apps/web/components/tool-guide.tsx`, `packages/ui/src/tool-shell.tsx`, `apps/web/app/globals.css`, the 12 tool pages.
- Tests: `apps/web/tests/tool-guides.test.tsx`, `apps/web/e2e/tool-guides.spec.ts`; one locator in `apps/web/e2e/organize.spec.ts`.
- `docs/adr/029-m6b-tool-page-guides.md`, ADR index, governance M6 row; ADR-028 and M6A report marked accepted and merged.
