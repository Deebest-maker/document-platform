# ADR-029: Tool-page guides (M6B)

**Status:** Implemented under the approved M6 gate; accepted and merged (`b760cb3`)
**Date:** 2026-10-22
**Scope:** Original written guidance under each of the 12 available tools, the component that shows it, and the tests that keep it true. No new tool, dependency, route or analytics. No structured data (M6D).
**Relates to:** SEO strategy (useful original content on tool pages, no scaled keyword filler, content must match what the tool really does); governance §14.2 (M6); ADR-028 (technical SEO); ADR-012 to ADR-025 (the behaviour the guides describe).

## Context

Each tool page had a working tool, a short privacy note, the limits and a list of related tools, but almost no explanation. A visitor, and a search engine, could not tell from the page what the tool does with their file, what it will not do, or how it differs from a neighbouring tool such as Split and Extract. The SEO strategy asks for useful, original, accurate pages and forbids generated filler. The risk in writing this copy is not style but truth: guidance that promises more than the tool does is worse than none.

## Decision

### 1. One guide per available tool, written by hand, in one file

`apps/web/content/tool-guides.ts` holds a record per registry slug with four parts:

| Part         | Purpose                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| Overview     | What the tool does, in two sentences or fewer                                  |
| Steps        | Three to five steps in the order the page presents them, using the real labels |
| Good to know | Three to six behaviours, limits and honest caveats that are not obvious        |
| Questions    | Three or four real questions with direct answers                               |

Every statement was checked against the tool's own page text and its decision record. Examples of what that caught: the Split range syntax and its duplicate-page rule (read from the parser), the exact output file names (read from the code), the fact that Compress does not turn screenshots into JPEG (ADR-025), and that Remove PDF Metadata is not redaction (ADR-020).

### 2. What the guides deliberately leave out

- **Numbers that live in the registry** (file counts, megabytes, page caps). The workspace shows them from the registry, so copying them into prose would let the two disagree after the next limit change. The guides say that a limit exists and point to where it is shown.
- **Savings, speed and quality promises.** No "up to X%", no "instant", no "perfect", and no "guarantee" except in the negative. This follows ADR-025, which already bars such claims for Compress.
- **A planned tool as if it were available.** PDF to Word is mentioned twice, only to say it is planned and was held back for quality (ADR-027).
- **Structured data.** FAQ markup is not added; M6D decides what markup is justified.

### 3. One component, and a semantic fix

`ToolGuide` (a server component) renders the four sections as real headings, an ordered list for steps and a list for notes, followed by the Related tools list. It is the only thing the 12 pages pass to the shared `related` slot, which also removes the same related-tools block that was repeated in each page.

While adding it I found that the shared `ToolShell` wrapped whatever was passed to `related` in an `<aside aria-label="Related tools">`. Guide text in that region would be announced to screen-reader users as a side note labelled "Related tools". The shell now wraps the slot in a neutral `<div>`, and `ToolGuide` supplies the labelled `<aside>` around the Related list only. The guide sits in the main content where it belongs.

The heading text is built as one string so it reaches the HTML as a single text node (`About Merge PDF`), not split by React comment markers.

### 4. Tests keep the guides true

`apps/web/tests/tool-guides.test.tsx` (24 tests) and `apps/web/e2e/tool-guides.spec.ts` (12 pages in two browser projects):

- Every available tool has a guide, and no guide exists for a tool the registry does not offer (so PDF to Word cannot get one).
- Shape and substance: section counts, no placeholder text, 180 to 520 words per guide, overview of two sentences or fewer.
- **No sentence appears twice anywhere in the corpus**, and every overview and question is unique. This is what stops the pages turning into a template with the tool name swapped.
- No savings, speed or guarantee claims; no registry numbers in prose.
- On-device tools never mention uploads or servers; the server tool (Word to PDF) says it uploads, uses a server and deletes.
- **Every output file name a guide mentions must exist in the product's source**, and the exact button labels it quotes (for example "Merge PDFs", "Rotate selected left") must exist in the product.
- Rendering: the five headings in order, list sizes, Related tools after the guide, related tools from the registry.
- Browser: the same structure on every tool page in desktop and phone viewports, text present in the server-rendered HTML without script, no horizontal scroll, and an axe WCAG scan with zero violations.

I confirmed the tests can fail by injecting three defects (a wrong file name, a reused sentence, an upload claim on a local tool); each was caught.

## Finding recorded, then fixed in ADR-030

**Images to PDF kept photo metadata inside the PDF.** JPEG photos that need no rotation were embedded with their original bytes (ADR-017), and the PDF library embeds the whole JPEG, including the EXIF block. I confirmed this with a test image carrying a marker string: the string was present in the generated PDF. So camera details or GPS position stored in a photo could remain in the PDF, and Remove PDF Metadata does not clear them because they sit inside the image. This slice only made the guide say so in plain words. The owner then asked for everything that needed fixing to be fixed, and [ADR-030](030-m6b1-photo-metadata.md) removes the metadata from JPEGs before they are embedded; the guide wording was updated with it.

## Consequences

- Tool pages now carry between 200 and 383 words each (3,481 across the 12) of original, accurate text. That is the minimum useful content the SEO strategy asks for on a tool page; it is not meant to be rank-bait.
- Editing a guide is a code change with tests, which is deliberate: a copy edit that makes a false claim fails the build.
- If a tool's behaviour changes (a new option, a renamed button), the guide test for labels and file names fails until the guide is updated.
- The guides are English only. Localisation is outside the MVP.
- The copy has had one author and one review pass. A second reader, ideally someone who has not seen the code, should read it before launch.

## Alternatives considered

| Option                                              | Why not                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| One template with the tool name and facts filled in | Reads as boilerplate, repeats sentences, and is the scaled filler the strategy forbids.                                 |
| Put guide fields in the tool registry               | The registry holds facts used by logic and tests; long prose there would bloat every consumer and tempt copying limits. |
| Markdown files per tool                             | Needs a parser dependency and loses the compile-time link to registry slugs.                                            |
| Generate guides from the decision records           | Records describe engineering decisions, not what a visitor needs; wording would be wrong for the audience.              |
| FAQ structured data now                             | Defer to M6D, where each markup type must match visible content and be justified.                                       |
| Leave guide text inside the "Related tools" aside   | Wrong semantics for assistive technology (see §3).                                                                      |
