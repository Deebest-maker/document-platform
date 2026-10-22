# ADR-031: Learn hub (M6C)

**Status:** Implemented under the approved M6 gate; accepted and merged (`a5a26c9`)
**Date:** 2026-10-22
**Scope:** A Learn hub at `/learn` and eight original guides at `/learn/<slug>`, the component that shows them, links between guides, tool pages, the home page and the header, sitemap entries, and the tests that keep the guides true. No new tool, dependency, endpoint, storage or analytics. No author name, publication date or structured data (M6D). Server retention is not changed.
**Relates to:** SEO strategy (useful original content, no scaled keyword filler, content must match what the tools really do); governance §14.2 (M6); ADR-028 (technical SEO, sitemap); ADR-029 (the tool-page guides this builds on, and their rules); ADR-012 to ADR-030 (the behaviour the guides describe).

## Context

Each tool page now explains its tool (ADR-029). People also look for help with a task before they know which tool they need ("merge PDFs without uploading", "make a PDF smaller"), or with an idea that sits behind several tools (what resolution means, what OCR is, what a PDF can reveal about its author, what "processed on your device" does and does not promise). A tool page is the wrong place for that: it would grow long, repeat itself across twelve pages, and drift from the tool it is attached to.

The risk in adding content is the usual one. A set of thin pages written to catch searches adds nothing for the reader, is easy to get wrong about what a tool does, and sits badly with a product whose point is that the claims on it can be trusted. So the milestone is as much about the rules and the tests as about the eight pages.

## Decision

### 1. Eight guides, each tied to a task or idea the tools really serve

| Guide                                                                | Primary tool        | What it covers that a tool page does not                                                                                         |
| -------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| How to merge PDFs without uploading them (featured)                  | Merge PDF           | Why a merge can stay on the device, what carries over, how to see for yourself that nothing was sent                             |
| How to make a PDF smaller, and when you cannot (featured)            | Compress PDF        | Where PDF size comes from, why repacking alone often saves nothing, the cases that cannot shrink, other ways under a size limit  |
| How to split a PDF, or keep only some pages                          | Split PDF           | Which of Split, Extract and Delete suits which job, page-range examples, why deleting a page does not erase it from the original |
| How to turn photos or scans into one PDF                             | Images to PDF       | Taking usable photos, page size, fit and orientation choices, what the result can and cannot do                                  |
| How to save PDF pages as images                                      | PDF to JPG          | How resolution maps to pixels, when an image is the wrong output, what is lost                                                   |
| How to copy text out of a PDF, and what to do with scans             | PDF to Text         | Telling a text PDF from a picture, what OCR is, why layout is lost, an honest "this site does not do OCR"                        |
| What is hidden in a PDF, and what removing it does not do (featured) | Remove PDF Metadata | The three kinds of hidden information, covered text, a short check before sharing, the limits of metadata removal                |
| What “processed on your device” means, and when a tool uploads       | Word to PDF         | The privacy labels, how to verify them in the browser, what local processing does not protect, the one tool that uploads         |

Together they link to all twelve available tools; a test fails if an available tool has no guide, so adding a tool forces someone to decide where it is explained. Rotate PDF was missing from every guide in the first draft and was added to the split guide because of that test.

### 2. Rules for the copy

The rules of ADR-029 apply, and the tests below enforce them:

- **Every claim is about the shipped product or is general knowledge that does not depend on us.** Statements about a tool were checked against its page, its code and its decision record. Statements about PDFs in general (what a scan is, what OCR does, why a black box over text can leave the text) are standard and are written as such.
- **No numbers that live in the registry**: file counts, sizes and page caps are not copied into prose. The pixel sizes for A4 at 96, 150 and 300 DPI are arithmetic, not limits, and a test recomputes them.
- **No savings, speed, quality or guarantee claims.** Compress is never called lossless. The benchmark finding behind ADR-025 is stated only qualitatively.
- **No author, date, reviewer or endorsement.** There is no approved byline or brand yet (M6D), and inventing one would be a false statement on a trust-sensitive site. A test rejects the common forms.
- **No retention period** for abandoned Word to PDF jobs while it was undecided. _Update: the Product Owner has since decided 10 minutes ([ADR-032](032-abandoned-job-retention.md)); the privacy guide now states it from one shared value._
- **No offline promise.** Some engines load when a tool is first used, so the guides do not say the tools work without a connection.
- **Honest about limits.** The text guide says this site does not do OCR; the metadata guide lists what removal does not touch; the merge guide says signatures stop validating.
- **Originality.** No sentence repeats within the guides or against the tool guides, and no run of nine words is shared between a guide and any other text.

### 3. Structure in code

- `apps/web/content/learn-articles.ts` holds the eight records: slug, title, meta description, summary, intro, sections of paragraphs, lists and numbered steps, the tools the guide is about, related guides, and a `featured` flag.
- **Inline links are tokens, resolved at build time.** `{tool:merge-pdf}`, `{tool:merge-pdf|joining files}`, `{learn:<slug>}` and `{page:/privacy|Privacy page}` are turned into links by `lib/learn-text.ts`. A token that points at a planned tool, a guide that does not exist, a page that is not in the sitemap list, or that is malformed throws, so the build fails instead of shipping a dead or misleading link. Tool link text comes from the registry, so a renamed tool renames the link.
- `components/learn-article.tsx` renders a guide as a server component: one `h1`, a short contents list that jumps to each section, the sections, an aside of the tools in the guide and an aside of guides to read next. Text is in the HTML with no script needed.
- One folder per guide under `app/learn/<slug>/page.tsx`, each a few lines. That keeps the existing SEO wiring test meaningful: it discovers every `page.tsx`, requires the set of routes to equal the sitemap's path list, and checks each route's canonical and robots rule.
- `getIndexablePaths` and `buildSitemap` take the guide list as a parameter (defaulting to the real one) and add `/learn` and `/learn/<slug>`. Nothing else about indexing changes: the site is still `noindex` with no canonical until the owner sets the production address.
- Navigation: a **Learn** link in the header, a **From the guides** section on the home page (the three featured guides), and a **Learn more** section on every tool page listing the guides whose `tools` field includes that tool. No guide is an orphan, which a test checks.

### 4. Alternatives considered

| Option                                        | Why not                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Markdown or MDX files with a parser           | Adds a dependency and a build step, and finds a broken link only when someone clicks it. Typed data plus resolved tokens finds it at build time. |
| A dynamic `[slug]` route                      | Hides the pages from the SEO wiring test, which exists to catch a page added without the shared metadata.                                        |
| Pages generated per tool and task combination | Scaled filler, which the SEO strategy rules out. Eight guides that each say something are worth more than eighty that repeat.                    |
| A single long FAQ page                        | Mixes unrelated topics under one title; each topic gets no address of its own and the page grows without bound.                                  |
| Structured data now                           | M6D, after the owner decides the brand and the author or publisher line. Marking up an invented byline would be worse than none.                 |
| Putting the guides inside tool pages          | Repeats concepts twelve times and lengthens pages whose job is to get the visitor to the tool.                                                   |

## Evidence

- **New unit tests (57)** in `tests/learn-articles.test.tsx`: one page per guide and one guide per page; every available tool has a guide and a planned tool has none; every inline link resolves and a deliberately broken one is rejected; titles at most 64 characters and unique; descriptions 110 to 160 characters and unique; word counts between 450 and 1,300 per guide; no repeated sentence across the guides and the tool guides; no shared run of nine words; the claim checks listed above; output file names, button labels and A4 pixel sizes checked against the product source or recomputed; the Word to PDF description checked against the privacy copy; rendered structure (one `h1`, contents anchors match section ids, every internal link is a real route); the home, header, hub and tool-page links.
- **The tests can fail.** Each of these was put in and the suite failed: a link to the planned PDF to Word tool, "up to 80% smaller", a wrong button name, a wrong output file name, an "uploaded" claim for an on-device step, an invented "Reviewed by our editors in 2025", a wrong pixel size, and calling Compress lossless.
- **Existing tests updated** for the new section and routes: the tool-guide heading order, the sitemap URL pattern, and the sitemap test that listed only tools.
- **Browser tests (`e2e/learn.spec.ts`, two projects):** the hub and every guide return 200, have one `h1`, show every section heading, scroll to the section named in the contents list, contain the text in the server-rendered HTML, have no horizontal scroll, have every internal link answer 200 and pass the axe scan for WCAG 2 A and AA, 2.1 and 2.2 AA. A walk from the home page to a guide, to its tool and back to the guide; and the privacy guide's links. The `noindex` header and the missing-canonical checks now include `/learn` and a guide.
- **Fact-check corrections made before the tests were written.** The first draft said files are moved "up or down" (the buttons are Move earlier and Move later); told the reader to "start" the text extraction (it starts as soon as the file opens); described a "thumbnail" step and a "Convert" button that do not exist in PDF to JPG; said local tools work "on a background thread" (not all do); said Word to PDF converts in a "temporary workspace" (not something the product documents); listed two privacy labels where there are three modes; and described the request check as covering merges only and as "a plain fetch of the page's own files", when it applies to every on-device test and forbids anything but GET or HEAD requests to the same site. All were corrected, and the label and file-name tests now pin the true wording.

## Not covered, and limits

1. **The copy has been read by me, not by the owner.** It is accurate to the best of my reading of the code and decision records, but it is still draft marketing-adjacent text until you read it. Say what to change.
2. **No author, no date, no "last reviewed".** Those belong to M6D and need a decision from you. Until then the guides are unsigned.
3. **No images or diagrams.** The guides are text and lists. A diagram of where the pixels come from, or screenshots of the tools, would help some readers and would need maintenance when the interface changes.
4. **Reading level is not measured.** I wrote in plain sentences and capped paragraph length, but I did not run a readability formula.
5. **Browser instructions are untested.** The merge guide tells readers how to open the Network tab (F12, or Cmd+Option+I on a Mac, and that Safari needs its Develop menu switched on). That is general browser knowledge and I did not try it in Safari, Firefox or Edge; do it in M7 device testing.
6. **Examples are illustrative.** Page-range examples and the A4 pixel sizes are correct arithmetic, but I did not time or size real files for the guides.
7. **The Privacy page is still a draft.** The privacy guide defers to it for the retention period. Retention has since been chosen (ADR-032) and the guide was updated with it.
8. **Search performance is unknown.** Nothing here claims a ranking or traffic result, and the site remains `noindex` until launch settings are chosen.

## Consequences

- A new available tool fails the "every tool has a guide" test until a guide mentions it; a tool that becomes planned or is renamed breaks the build if a guide still links to it.
- Changing a button label that a guide quotes fails a test, which points at the sentence to update.
- Guide titles are used in four places (hub, home, tool pages, "Keep reading"), so a title change is one edit.
- M6D can add structured data and a byline by editing the one content file and the article component.
