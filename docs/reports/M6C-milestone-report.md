# M6C Milestone Report: Learn hub

**Date:** 2026-10-22
**Status:** Implemented; pull request open; owner acceptance pending.
**Preceding milestone:** M6B.1 — Photo metadata and copy accuracy (accepted and merged, `3a51a25`).
**Decision record:** [ADR-031](../adr/031-m6c-learn-hub.md).

## Summary

The site now has a Learn section: a hub at `/learn` and eight original guides, each about a task people actually bring to a PDF or an idea that sits behind several tools. About 4,600 words in total (480 to 660 words per guide). Every guide links to the tools it explains, every tool page links back to the guides about it, and the header and home page point to the section. As before, nothing is indexed yet (ADR-028 still governs that).

The guides are:

1. How to merge PDFs without uploading them
2. How to make a PDF smaller, and when you cannot
3. How to split a PDF, or keep only some pages
4. How to turn photos or scans into one PDF
5. How to save PDF pages as images
6. How to copy text out of a PDF, and what to do with scans
7. What is hidden in a PDF, and what removing it does not do
8. What “processed on your device” means, and when a tool uploads

## What was implemented

- **Content** (`apps/web/content/learn-articles.ts`): eight guides of 480 to 660 words (a test requires 450 to 1,300), with sections, lists and numbered steps. Each lists the tools it is about and which guides to read next.
- **Links that cannot go stale** (`apps/web/lib/learn-text.ts`): links inside the text are written as `{tool:merge-pdf}`, `{learn:<slug>}` and `{page:/privacy|…}` and checked when the site is built. A link to a planned tool, a guide that does not exist or a page that is not in the sitemap fails the build. Tool link text comes from the registry.
- **Pages:** `/learn` (hub) and `/learn/<slug>` for each guide, with one heading, a short contents list that jumps to each section, a list of the tools in the guide and a "Keep reading" list. The text is in the server-rendered HTML.
- **Navigation:** a **Learn** link in the header; a **From the guides** section on the home page (three featured guides: merging without uploading, making a PDF smaller, what is hidden in a PDF); a **Learn more** section on every tool page.
- **Sitemap:** `/learn` and the eight guides are listed when indexing is switched on. With the current default settings the sitemap is still empty and every page is `noindex`.
- **Style:** one readable column, real list markers, a contents box; no new fonts or images.

## Verification

- **57 new unit tests** (`tests/learn-articles.test.tsx`) keep the guides true. Among them: every available tool has a guide (and the planned PDF to Word has none); every link resolves; no sentence is repeated in the guides or against the tool guides, and no run of nine words is shared with any other text; no registry numbers, savings or speed promises, or "lossless" for Compress; no invented author, date, review or endorsement; no retention period and no offline promise; uploads are mentioned only to deny them or to describe Word to PDF; every output file name and every button name quoted is one the product has; the A4 pixel sizes are recomputed; the Word to PDF description matches the Privacy page.
- **The tests can fail.** I put in a link to the planned PDF to Word tool, "up to 80% smaller", a wrong button name, a wrong file name, an upload claim for an on-device step, an invented "Reviewed by our editors in 2025", a wrong pixel size, and "lossless" for Compress. All eight were caught.
- **Facts checked against the code before the tests were written.** This caught real mistakes in my first draft: "up or down" instead of the buttons' real names Move earlier and Move later; a "Start" step in PDF to Text that does not exist because extraction begins when the file opens; a thumbnail step and a "Convert" button in PDF to JPG that are not there; a claim that local tools run "on a background thread"; a "temporary workspace" for Word to PDF that the product does not document; two privacy labels where there are three modes; and a request-check description that was narrower and looser than what the browser tests really enforce. Rotate PDF was also missing from every guide until the "every tool has a guide" test found it.
- **Browser tests** (`e2e/learn.spec.ts`, desktop and phone width): the hub and each guide return 200 with one heading, show every section, jump to the section named in the contents, have their text in the raw HTML, do not scroll sideways, have every internal link answer 200, and pass the accessibility scan (WCAG 2.2 AA rules, as in the rest of the suite) with zero violations. A walk home page → Learn → a guide → its tool → back to the guide works. `noindex` and no canonical still hold for `/learn` and a guide.
- **One regression found and fixed:** the merge privacy test only accepts requests to a fixed list of site pages. The merge page now links to the Learn pages, and the browser fetches linked pages ahead of time, so the test saw two requests it did not expect. They are plain page fetches carrying no document data, so I added `/learn` and the eight guide addresses (built from the guide list) to that list. Nothing else about the check changed: any other route, any non-GET request and any canary or file name in a request still fail it.
- **Existing tests updated:** the tool-guide heading order now includes "Learn more"; the sitemap URL pattern and one sitemap test now allow guide addresses.
- **Full local run:** format, lint, types and production build pass. Web unit tests: 268 pass (was 210). Library tests are unchanged at 303. Browser suite: 292 pass and 14 fail. The 14 are the same 7 PDF recovery and image-export tests in two browser projects that also fail on unmodified main in this sandbox (Node 22 here, Node 24 required), so CI is the check that counts.
- **Not verified:** how the guides read to someone who has not seen the code; the Network-tab instructions in Safari, Firefox and Edge; Safari or Firefox rendering of the new pages (plain text and lists).

## Known limitations

1. **The copy has been read only by me.** It is checked against the code and decision records, but you should read it. I can export all eight guides to a Word file.
2. **No author, date or "last reviewed" line.** None is approved, and inventing one would be a false claim. This belongs to M6D.
3. **No images or diagrams.** A diagram of where PDF size comes from or screenshots of the tools would help some readers but would need upkeep when screens change.
4. **Reading level is not measured.** Paragraphs are capped and the sentences are plain, but I did not run a readability score.
5. **English only.** The Trust pages (About, Privacy, Terms, Contact) are still draft wording and must be finalised before indexing is turned on.
6. **No search performance claim.** The site is `noindex`; nothing here promises ranking or traffic.

## Deviations from plan

None. The eight topics are the ones proposed in the M6B report. One structural detail differs from a simple "article" page: each guide has a small contents list, because the longer guides have six or seven sections.

## Decisions needed from the Product Owner

1. **Accept M6C**, so the next milestone can start.
2. **Read the guides** in `apps/web/content/learn-articles.ts` (or ask for a Word export) and tell me what to change.
3. **Server retention** for abandoned Word to PDF jobs: A 15 minutes (today), **B 10 minutes (recommended)**, C 5 minutes. Reply "B" and I will apply it with its tests and wording. The privacy guide already says the period is undecided and points to the Privacy page, so it stays true either way.
4. **Needed before M6D can be done properly:** the production domain, the brand or product name, and who is named as author or publisher. Without them, structured data and social images would carry invented names.
5. **Still open:** hosting budget; final legal copy; Safari, Firefox and phone testing (a launch gate for M7 and M8).

## Recommended next

If you can give the three items in decision 4, **M6D** (structured data, breadcrumbs and social images) comes next. If not, I suggest starting **M7 — QA and hardening** and leaving M6D until they exist: M7 does not depend on them. I will not start either until you say so.

## Files

- Content and code: `apps/web/content/learn-articles.ts`, `apps/web/lib/learn-text.ts`, `apps/web/components/learn-article.tsx`, `learn-inline.tsx`, `learn-list.tsx`, `apps/web/app/learn/` (hub and eight guide pages), `apps/web/lib/seo.ts`, `apps/web/components/site-header.tsx`, `tool-guide.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`.
- Tests: `apps/web/tests/learn-articles.test.tsx`, `apps/web/e2e/learn.spec.ts`; updated `tests/seo.test.ts`, `tests/tool-guides.test.tsx`, `e2e/tool-guides.spec.ts`, `e2e/seo.spec.ts`.
- Documents: `docs/adr/031-m6c-learn-hub.md`, ADR index, governance M6 row; ADR-030 and the M6B.1 report marked accepted and merged.
