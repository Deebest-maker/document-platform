# M6A Milestone Report: Technical SEO foundation

**Date:** 2026-10-21
**Status:** Implemented; pull request open; owner acceptance pending.
**Preceding milestone:** M5 — Hard Tools / Spikes (complete; M5B accepted and merged at `20ac497`, source-document sync at `3464b92`).
**Decision record:** [ADR-028](../adr/028-m6a-technical-seo.md).

## Summary

The site can now tell search engines the right thing in every environment, and it says "do not index" unless you turn indexing on. One build setting pair controls it: `SITE_URL` (the public address) and `SITE_INDEXING=on`. With neither set, which is today's situation, the site is exactly as private as before. At launch (M8) indexing is switched on for the production build only, with no code change.

Nothing is indexed today, no page content changed, and no dependency was added.

## What was implemented

- **Site settings** (`apps/web/lib/site.ts`): reads the two build settings and accepts only a clean `https` address (or `http` for local development). Indexing stays off unless the address is valid and the value is exactly `on`.
- **One metadata helper** (`apps/web/lib/seo.ts`): every page now gets its title, description, robots rule and, when an address is known, its canonical link and Open Graph data from it. The 12 tool pages, the 5 static pages and the home page were switched over; no page writes `robots` by hand any more.
- **`robots.txt`:** blocks everything unless indexing is on; when on, allows the site, blocks `/api/` (the processor proxy) and links the sitemap.
- **`sitemap.xml`:** empty unless indexing is on. When on it lists the home page, Tools, About, Privacy, Terms, Contact and every tool marked `available` (18 addresses today). Planned tools such as PDF to Word are never listed. No invented modification dates.
- **`X-Robots-Tag: noindex, nofollow` header** on every response while indexing is off, as a second safeguard that also covers the 404 page and non-HTML files.

## Verification

- **Unit and wiring tests:** 37 new tests. They cover address validation, the exact-value rule, metadata in all three states (default, staging with address, production), both `robots.txt` modes, the sitemap content, and that every route in `app/` uses the shared helper under four different settings. The sitemap must list exactly the pages that exist, so it cannot advertise a 404. I confirmed the wiring test can fail by breaking one page on purpose.
- **Browser tests:** 9 new specs in two browser projects check `robots.txt`, the sitemap, the header on pages, on `robots.txt` and on the 404, and the absence of canonical and Open Graph tags without an address. With the existing shell tests: 52 of 52 passed.
- **Production build with indexing on (by hand):** `robots.txt` allows `/`, blocks `/api/` and links the sitemap; the sitemap has 18 absolute addresses and no PDF to Word; the home page canonical (`https://example.com`) is identical to its sitemap entry; tool pages are `index, follow` with their own canonical and Open Graph tags; the noindex header is gone; `/pdf-to-word` still answers 404.
- **Full local run:** format, lint, types, 170 web tests and 275 browser-library tests pass; the production build passes; 240 browser tests pass and 14 fail. The 14 are 7 PDF recovery and image-export tests in each of two browser projects. I ran the same 7 on unmodified main in this sandbox and they fail the same way, so they come from this environment (Node 22 here; the project requires Node 24), not from this change. The pull request's CI run on Node 24 is the check that counts.
- **Not verified:** how the pages look in a search engine, because nothing is public. Safari and Firefox were not run for the new checks (the checks are about headers and tags, not rendering).

## Security and privacy

- No new dependency, endpoint, storage, cookie, analytics or third-party request. The new routes serve static text.
- The safeguard is two-layered (page tag and response header) and defaults to off, so a forgotten or preview build cannot be indexed by mistake.
- Documents are untouched: nothing here sees, stores or sends a user file.

## Known limitations

1. The trust pages (About, Privacy, Terms, Contact) are still placeholders. The sitemap will list them once indexing is on, so **they must be finalised before launch**.
2. There is no production domain yet; canonical links appear only when `SITE_URL` is set.
3. The settings are read at build time, so changing them needs a new build. This is intentional (ADR-028) but means staging and production are separate builds.
4. No structured data, social images or breadcrumbs yet (M6D). Open Graph tags carry text only.
5. Home page canonical has no trailing slash, as Next.js renders it; the sitemap matches that form.

## Deviations from plan

None. One correction during the work: I first wrote the sitemap's home entry with a trailing slash, then saw the page's canonical has none, and made the sitemap match.

## Decisions needed from the Product Owner

1. **Accept M6A**, so I can start M6B.
2. **Server retention default** for abandoned Word to PDF jobs (still open from M4): A 15 min (today's default), **B 10 min (my recommendation)**, C 5 min. Reply "B" and I will apply it. It stays 15 minutes until you choose.
3. **Production domain** and **brand/author name** for article markup. Neither is needed for M6B or M6C, but both are needed for M6D and launch.
4. **Safari, Firefox and phone testing** of Compress PDF remains a launch gate (M7/M8), not a blocker here.

## Recommended plan for the rest of M6 (nothing started)

- **M6B — tool-page content template.** Below each tool, original copy built from registry facts: what it does, steps to use it, how your file is handled (from the processing mode), limits (from the registry), a short honest FAQ and related tools. No filler, and no claim the tool cannot support. Tests check every available tool has it and that text is not duplicated between tools.
- **M6C — Learn hub and 6 to 10 original guides** (for example how to merge, split, compress and convert PDFs safely, and what "on your device" means). The route name `learn` is already reserved.
- **M6D — structured data and polish.** Breadcrumbs and Article markup only where the visible page matches, social preview images, and category pages if you want them.

I will not start M6B until you accept M6A.

## Files

- `apps/web/lib/site.ts`, `apps/web/lib/seo.ts`, `apps/web/app/robots.ts`, `apps/web/app/sitemap.ts`, `apps/web/next.config.ts` (header).
- `apps/web/app/layout.tsx`, home page, 5 static pages and 12 tool pages (metadata only).
- Tests: `apps/web/tests/site-config.test.ts`, `seo.test.ts`, `seo-wiring.test.ts`, `apps/web/e2e/seo.spec.ts`.
- `docs/adr/028-m6a-technical-seo.md`, ADR index, governance M6 row.
