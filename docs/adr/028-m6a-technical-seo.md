# ADR-028: Technical SEO foundation, with indexing off by default (M6A)

**Status:** Implemented under the approved M6 gate; owner acceptance pending
**Date:** 2026-10-21
**Scope:** The first slice of M6: how pages declare themselves to search engines, `robots.txt`, `sitemap.xml` and the "do not index" safeguards. No page content, no structured data, no Learn section and no analytics were added.
**Relates to:** SEO strategy (server-rendered pages, canonical tags from the registry, sitemap only for published canonical pages, staging `noindex`, real 404s for missing tools, no scaled keyword filler); governance §14.2 (M6) and §14.4 (M8 launch); the tool registry as the one source of tool facts (`availability`).

## Context

Until now every page said `noindex` by hand: one `robots` line in the layout and another in each tool page. That was safe, but it cannot be switched on at launch without editing 18 files, and nothing stopped a new page from forgetting the line. There was no `robots.txt`, no sitemap and no canonical link. The launch decision (M8) needs one clearly named switch, off by default, that a preview or staging build can never trip by accident.

## Decision

### 1. Two build-time settings, one build per environment

| Setting         | Meaning                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `SITE_URL`      | The public origin, for example `https://example.com`. No path, query, fragment or login. |
| `SITE_INDEXING` | The exact value `on` lets search engines index the site. Anything else is off.           |

- **Off is the default.** With nothing set, the site behaves exactly as it did before M6A.
- **Indexing needs a valid origin.** `SITE_INDEXING=on` with a missing or malformed `SITE_URL` stays off, because there is no canonical address to point search engines at.
- **A valid origin is `https`**, or `http` only for `localhost`, `127.0.0.1` and `[::1]`. Credentials, a path, a query or a fragment make it invalid.
- **One build is one environment.** Next.js reads these when it builds, so a staging build and a production build are two builds with different settings. This is deliberate: a runtime switch could be flipped in the wrong place without a new build to review.
- Staging may set `SITE_URL` without `SITE_INDEXING`. It then gets canonical links but stays `noindex` and `Disallow: /`.

All of this lives in one small module (`apps/web/lib/site.ts`) that has no dependencies, so `next.config.ts` can import it.

### 2. One helper builds every page's metadata

`apps/web/lib/seo.ts` exports `seoMetadata` (static pages), `toolMetadata` (tool pages, from the registry record) and `siteRobots`. Each takes the site config as a parameter, so both states are unit-tested. Pages never write `robots` by hand.

| State                     | `robots` meta | Canonical link | Open Graph | `X-Robots-Tag` header |
| ------------------------- | ------------- | -------------- | ---------- | --------------------- |
| Off, no origin (default)  | noindex       | none           | none       | `noindex, nofollow`   |
| Off, origin set (staging) | noindex       | yes            | yes        | `noindex, nofollow`   |
| On (production)           | index, follow | yes            | yes        | none                  |

- The canonical address is the clean path (`/merge-pdf`), so query strings and fragments never become separate indexable pages. It is resolved against `metadataBase`, which is set only when the origin is valid.
- The layout does **not** set a canonical, because a layout-level value would be inherited by any page that forgot its own.
- Next.js replaces, rather than merges, nested `openGraph` objects, so the helper includes title, description and URL in every page's Open Graph data.

### 3. `robots.txt`

- **Off:** `User-Agent: *` and `Disallow: /`. No sitemap line.
- **On:** `Allow: /`, `Disallow: /api/` (the processor proxy; it is not content), and a `Sitemap:` line with the absolute address.

### 4. `sitemap.xml`

- **Empty unless indexing is on.** A staging sitemap that lists staging pages would be a leak.
- **Contents when on:** the home page, `/tools`, About, Privacy, Terms, Contact, and every tool whose registry `availability` is `available`. A `planned` or `preview` tool is left out, so PDF to Word (deferred, ADR-027) is never listed.
- **Absolute `https` addresses, no fragments or queries, no duplicates.** The home page is the bare origin, because that is the canonical Next.js renders for `/`.
- **No `lastModified`, `priority` or `changeFrequency`.** We have no real modification dates, and search engines mostly ignore the other two. Made-up dates would teach crawlers to distrust the file.
- A test asserts that every listed path has a page, so the sitemap can never advertise a 404.

### 5. Header as a second layer

When indexing is off, `next.config.ts` sends `X-Robots-Tag: noindex, nofollow` on every response, including files that have no HTML head and the 404 page. If the page metadata were ever wrong, the header would still say no.

### 6. Missing tools stay real 404s

Planned tools have no route, so `/pdf-to-word` answers 404 (tested end to end, and now also checked for the header). There are no "coming soon" pages.

## Verification

- **Unit (32 tests):** origin parsing (valid, trailing slash, uppercase, port, http only for local hosts; path, query, fragment, credentials, `ftp:`, `javascript:` and `data:` rejected), the exact-value rule for `on`, metadata in all three states, `robots.txt` in both modes, sitemap content, exclusion of planned tools, no duplicates, no invented dates, and that every listed path has a page.
- **Wiring (5 tests):** the test discovers every `page.tsx` under `app/`, loads it under four environments (default, origin only, on, invalid origin) and checks robots, canonical and Open Graph for all 18 pages and the layout. The set of pages must equal the set the sitemap can list. I checked it can fail: replacing one page's metadata with a hand-written `robots` made it fail.
- **Browser (9 specs x 2 projects):** `robots.txt` disallows all with no `Allow` or `Sitemap` line; `sitemap.xml` is valid and has no `<loc>`; `X-Robots-Tag` is present on pages, on `robots.txt` and on the 404 for `/pdf-to-word`; no canonical or Open Graph tag appears without an origin.
- **Indexing-on build, by hand:** I built with `SITE_URL=https://example.com SITE_INDEXING=on` and fetched the result. `robots.txt` allows `/`, blocks `/api/` and links the sitemap; the sitemap lists 18 absolute addresses (6 static pages and the 12 available tools, none planned); `/pdf-to-word` is absent from it and answers 404; `/merge-pdf` has `index, follow`, a canonical of `https://example.com/merge-pdf` and matching Open Graph tags; no `X-Robots-Tag` header is sent. That check is not part of CI because CI builds once with the default settings.

## Consequences

- **Nothing is indexed today.** The product preview banner and "Product preview" copy are unchanged. M8 flips the switch by setting two build variables for the production build; no code change.
- The trust pages (About, Privacy, Terms, Contact) are still placeholders. They are in the sitemap list because the SEO strategy requires them at launch, but **they must be finalised before indexing is turned on**. This is recorded as a launch gate, not solved here.
- Production domain and brand/authorship are still undecided. They are needed for the real origin and for `Article` markup in M6D.
- `SITE_URL` must be set for every build that should have canonical links, including staging. A build with neither variable has no canonical links by design.
- Changing the origin changes every canonical address, so it should be decided once.

## Alternatives considered

| Option                                            | Why not                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Runtime environment switch (read per request)     | Would force dynamic rendering of every page and let a config change flip indexing with no build to review. |
| Keep hand-written `robots` on each page           | Cannot be turned on from one place, and a new page can forget it.                                          |
| A single `NODE_ENV=production` rule               | Staging and preview builds are production builds too; indexing would turn on for them.                     |
| Sitemap with today's date as `lastModified`       | Invented data. Crawlers learn to ignore it.                                                                |
| Sitemap that lists planned tools as "coming soon" | Violates the strategy: no thin or placeholder pages, and those routes are real 404s.                       |
| `X-Robots-Tag` only (no page meta)                | Harder to test in unit tests and invisible to anyone viewing page source. Both layers cost almost nothing. |
