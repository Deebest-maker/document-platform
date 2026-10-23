# ADR-034: Web security headers and Content Security Policy

**Status:** Implemented under the approved M7 gate; accepted by the Product Owner on 2026-10-23
**Date:** 2026-10-22
**Scope:** The headers the web app sends with its pages, scripts and data files; a Content Security Policy for pages and a separate one for Web Workers; the build step that makes the page policy possible on prerendered pages; the site's own 404 and error pages; and the tests that check all of it. No change to what any tool does, where any file is processed, the processor, or the page content.
**Relates to:** document 05 section 13 (browser security) and section 19 (launch gates), document 09 (security headers and CSP coordinated with Next.js and ads/analytics), ADR-028 (`X-Robots-Tag`), ADR-033 (the processor's own headers), governance section 14.3.

## Context

Until now the site sent no security headers except `X-Robots-Tag` on builds that are not meant to be indexed. Document 05 asks for "a restrictive Content Security Policy compatible with required workers/WASM", clickjacking protection, and extracted document text shown as text.

Three facts shape the design:

1. **Every page is prerendered.** Next.js writes three inline scripts into each page (its start-up code and the page data). A page policy has to allow those and nothing else.
2. **The tools use workers, WebAssembly and in-memory images.** PDF.js reads documents in a worker and decodes some images with WebAssembly; previews and results are drawn from `blob:` and `data:` images.
3. **A Web Worker does not inherit the page's policy when it is started from a file.** It takes its limits from the response that delivered its own script. Without a policy on those responses a worker has no limits at all, and a worker is where a document is parsed.

## Threats addressed

| #   | Threat                                                                                                         | Control                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Script or markup injected into a page runs                                                                     | Page policy: scripts only from this origin's files and the page's own inline scripts by hash; no `unsafe-inline`, no `unsafe-eval`                 |
| T2  | Injected markup loads from, or sends data to, another site                                                     | `default-src 'none'`; images, fonts, connections, workers and manifests limited to this origin; no `<base>`, no form posts, no frames, no plug-ins |
| T3  | A hostile PDF takes over code running in a worker and sends the document away                                  | Worker policy on every script file: connections to this origin only; no `eval`; WebAssembly allowed and nothing else added                         |
| T4  | The page is shown inside another site (clickjacking)                                                           | `frame-ancestors 'none'` and `X-Frame-Options: DENY`                                                                                               |
| T5  | A browser guesses a file is a different type                                                                   | `X-Content-Type-Options: nosniff` on every response                                                                                                |
| T6  | The address of the page a visitor came from is passed to the next site                                         | `Referrer-Policy: no-referrer`                                                                                                                     |
| T7  | Powerful features (camera, microphone, location, payment, USB, sensors) used by the page or anything it embeds | `Permissions-Policy` switches off the ones the site never uses                                                                                     |
| T8  | Another window reaches this one through a shared browsing context                                              | Not addressed. `Cross-Origin-Opener-Policy` was tried and removed (decision 11).                                                                   |

## Decisions

**1. Hashes, not nonces.** A nonce must be new for every response, so Next.js can only apply one to pages rendered on each request. That would turn every prerendered page into a dynamic one: no static optimisation, no CDN caching, slower pages and a bigger server, which Next.js's own guide lists as the cost. A hash needs none of that. `'unsafe-inline'` was rejected: it would let an injected inline script run, which is the main thing a policy is there to stop.

**2. Where the hashes come from.** `scripts/csp-manifest.mjs` runs at the end of `pnpm build`. It reads each built page, hashes the exact text of every inline script, and writes `.next/csp-manifest.json` (route to hashes). `apps/web/proxy.ts` reads that file once and sets the `Content-Security-Policy` header per request from the page's own hashes. A path that is not a page (a 404) gets the hashes of the 404 page and the framework's error page. Because the hashes come from the pages the build actually produced, the policy cannot drift from the pages; a page that changes gets a new hash with the next build.

**3. The build refuses pages the policy would break.** The same step audits every built page and fails the build, naming the page, if it finds an inline `<style>`, a `style=""` attribute, an `on...=` handler, a `javascript:` link, a frame, object, embed or `<base>`, or a script, stylesheet, image or form that loads from another origin. A mistake therefore shows up in `pnpm build` with a name, not as a blank page. The one exception is stated in decision 9.

**4. Fail closed.** If the manifest is missing or unreadable, the policy names no inline script, the pages do not start, and the server logs one error. A dead site is noticed within minutes; a quietly weaker policy would not be.

**5. A production rule.** The development server needs `eval` and inline scripts for hot reload, so the page policy and the worker policy are added only to production builds. The browser tests run against a production build (`pnpm start`).

**6. The page policy, directive by directive.**

| Directive                                                  | Value                          | Why                                                                                                             |
| ---------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `default-src`                                              | `'none'`                       | Everything not named below is refused.                                                                          |
| `script-src`                                               | `'self'` and the page's hashes | The app's files (including dynamic imports of the ZIP and image libraries) and Next.js's inline scripts.        |
| `style-src`                                                | `'self'`                       | Stylesheet files only. Setting a style from script through the style object still works, which React relies on. |
| `img-src`                                                  | `'self' blob: data:`           | Previews and results are drawn from in-memory images.                                                           |
| `font-src`, `connect-src`, `worker-src`, `manifest-src`    | `'self'`                       | The Word to PDF API is reached through this origin. A worker made from text (`blob:`) is not allowed.           |
| `object-src`, `base-uri`, `form-action`, `frame-ancestors` | `'none'`                       | Nothing on the site uses them.                                                                                  |

**7. The worker policy.** Every file under `/_next/static/` is sent with `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; ...`. A page ignores a policy on a script file; a worker started from it obeys it. So a worker can run this app's scripts and WebAssembly (the PDF reader needs it), can fetch this origin's own data files (fonts, colour tables), and can reach nothing else: a document opened in a worker cannot be sent anywhere, even if a flaw in the reader let a hostile PDF run code. `wasm-unsafe-eval` is here and not in the page policy because no page code needs it.

**8. The plain headers.**

| Header                   | Value                                                                                                                         | Note                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `X-Content-Type-Options` | `nosniff`                                                                                                                     | Every response.                                                                            |
| `Referrer-Policy`        | `no-referrer`                                                                                                                 | Nothing on the site needs the referrer. Revisited at M9 if advertising requires otherwise. |
| `X-Frame-Options`        | `DENY`                                                                                                                        | Repeats `frame-ancestors` for engines that predate it.                                     |
| `Permissions-Policy`     | accelerometer, camera, display-capture, geolocation, gyroscope, magnetometer, microphone, midi, payment, usb all switched off | Only names every current engine recognises, so no browser reports an unknown feature.      |

The processor's replies under `/api/processor/` keep the processor's own headers (ADR-033); the site headers are not added there, so no header is sent twice, and the proxy does not run for `/api`, `/_next` or `/vendor`.

**9. The site's own 404 and error pages.** Next.js's built-in 404 and error pages style themselves with an inline `<style>` and `style=""` attributes, which the policy refuses. `app/not-found.tsx` and `app/global-error.tsx` replace them with pages that use the site's stylesheet. Next.js also builds a plain "500: This page couldn't load" page of its own that cannot be replaced from the app. It shows as unstyled text under the policy. It holds no document data and appears only for a server failure. The audit makes this one exception, for inline styles of that one page, and says so in the code.

**10. Left out on purpose.**

- `Strict-Transport-Security` and `upgrade-insecure-requests`: both belong to the HTTPS edge and are M8 items. Neither can be tested or relied on before there is a real HTTPS host.
- `Cross-Origin-Embedder-Policy`: it would block assets served from another origin, such as a CDN, and nothing needs the isolation it gives.
- A reporting endpoint (`report-to`): it would be new infrastructure, and a report carries the address and part of the offending code. Revisit with monitoring in M8.
- Trusted Types: Next.js and React create script elements and write markup in ways that would need changes there first.

**11. `Cross-Origin-Opener-Policy` was tried and removed.** The first version of this record set `Cross-Origin-Opener-Policy: same-origin`, so the site would sit in a browsing context group of its own. The five-browser run then showed Firefox stalling a page load for the full 30 seconds in a few tests per run, a different few each time. I measured it instead of guessing, in Firefox runs on CI: with the header on there were 26 stalls in about 3,400 test runs (20 with the Content Security Policy also on, 6 with only the policy removed); with the header off there were none in about 2,500 (about 1,250 with the policy on, about 1,250 with every security header removed). Chromium and WebKit were not affected. It is not clear whether real Firefox visitors would be affected, since the measurement is Firefox driven by Playwright, so there is no reason to find out on live visitors. The protection it gave was small: the site opens no windows and links out with `rel="noopener"`. It is out of the list, a unit test and a browser test check that it stays out, and re-adding it needs the same measurement on real Firefox (M7G or M8).

## What changed

- `apps/web/lib/security/policy.mjs` (+ `.d.mts`): the policies and plain headers, in one place, shared by the config, the proxy, the build step and the tests.
- `apps/web/lib/security/document-policy.ts`: reads and checks the manifest; maps a request path to its policy.
- `apps/web/proxy.ts`: sets the page policy (production builds; not for `/api`, `/_next`, `/vendor`).
- `apps/web/next.config.ts`: the plain headers on every response except `/api/processor`, and the worker policy on `/_next/static/`.
- `scripts/csp-manifest.mjs` (+ `.d.mts`): hashes inline scripts, audits built pages, writes the manifest; run by `pnpm build`.
- `apps/web/app/not-found.tsx`, `apps/web/app/global-error.tsx`: the site's own 404 and error pages.
- Tests: see Evidence.

## Evidence

- **Unit tests (web: 391 pass, 95 new).** The build step (inline-script extraction and hashing, one case for each thing the audit refuses, the 404 and error-page rules, the command's exit code), the policy loader (a tampered or missing list is refused, route matching, unknown paths, object-key paths such as `/__proto__`, the one-time error), the policy text (no `unsafe-*`, no other origin, every directive), which responses get which headers (with the route patterns matched the way Next.js matches them), the proxy and its matcher, and the 404 and error pages (no inline style, handler or script).
- **Browser tests (25 new in each browser project).**
  - `security-headers.spec.ts` (8): for every page the build produced, the policy of the served response names exactly the inline scripts in that response's body; every page's policy is strict; the plain headers are on every page; unknown paths get a 404 whose scripts are covered; script files carry the worker policy; a browser will not show the page in a frame on a real second site. That check has a control: the same frame with the framing headers removed on the way in does load the page's files, so the test can tell a shown page from a refused one.
  - `csp-enforcement.spec.ts` (5): what an attacker would try, run in the page: an injected inline script, an inline handler, a `javascript:` link, `eval`, `new Function` and string timers (from a script of ours, since code run through the debugger is exempt), `import()` of a data URL, an off-site script, image, fetch and WebSocket, a frame, a form post, a `<base>` rewrite, a worker made from text, an inline `style` attribute and `<style>` element. Nothing ran, nothing reached the trap standing in for the internet, and the browser reported each kind of refusal. A second test shows what is still allowed (style object, own data, in-memory images). Two more start a worker from the real worker script with its body replaced: without the policy header it sends data off-site and evaluates text (so the trap works); with it, it can do neither, and WebAssembly still works.
  - `hostile-content.spec.ts` (12): five hostile file names on each of the 12 tools. Where a tool shows the name (Merge, Images to PDF, Word to PDF) it appears as written; on every tool, nothing became an element, handler or script.
  - Every existing browser test now also fails if the policy refused anything (page `securitypolicyviolation` events and the browser's own refusal messages, which also cover workers).
- **Five-browser CI run on the final commit:** desktop and phone Chromium, Firefox, WebKit and phone WebKit all pass, including the 8 tests per project that cannot run in my environment. Two extra Firefox-only runs of the whole suite, each run twice (716 test runs), had no failure. Getting there found three problems, all in tests or in one header, none in the policy: Playwright's own WebKit screenshot code adds a style element the policy refuses (the tests now set aside exactly one such refusal per screenshot, WebKit only, unit tested); Firefox reports a forbidden form by throwing, which the injection test now treats as a refusal; and the Cross-Origin-Opener-Policy header made Firefox stall page loads (decision 11).
- **Full desktop and phone Chromium run, before CI:** 342 pass, 16 fail. The 16 are the same 8 tests in each project that fail on unmodified `main` in this environment (Node 22 here, Node 24 required); I ran them on `main` to confirm. CI is authoritative for them.
- **The tests can fail.** One finding from checking this: the first version of the framing test passed for the wrong reason. Chromium refuses to let a page Playwright makes up for a made-up address reach a server on this machine (`ERR_BLOCKED_BY_PRIVATE_NETWORK_ACCESS_CHECKS`), so the frame stayed empty with or without the headers. It was rewritten to use a real second site (a small server of its own on `localhost`) and the control above, and it now fails against a build without the framing headers. I weakened the policy in 15 ways, one at a time, rebuilt each time, and every one was caught by at least one unit test and one browser test: inline code allowed, eval allowed, open `connect-src`, open `img-src`, inline styles allowed, no `base-uri`, form posts allowed, `blob:` workers allowed, `default-src 'self'`, worker connections open, worker `eval` allowed, no worker policy header, proxy setting nothing, one hash dropped from every page, no `nosniff`, no framing protection. One case is caught only by the header-text tests, not by a browser: browsers ignore `'unsafe-inline'` when hashes are listed, so adding it changes nothing a browser enforces, yet it would be a weaker policy for any browser that does not. Separately, making Merge render the file name as HTML failed both the hostile-name test and the policy check; and writing the build audit's tests found a real hole in my first version (it blanked a script tag before checking whether it loaded from another site).
- **Live check of the processor path:** with a stand-in processor behind the real production server, a reply under `/api/processor/` carried the processor's own headers once each and none of the site's.
- **The installed PDF.js (6.3.289) contains no `eval` or `new Function`**, so refusing them in workers costs nothing.

## Not covered, and limits

1. **Real Safari and Firefox.** The policy is the same in every engine and the browser tests run in Playwright's Chromium, Firefox and WebKit on CI, but Safari on a Mac or an iPhone and Firefox on a desktop are checked by hand in M7G.
2. **`'self'` allows any script on this origin.** That is the normal rule and is safe while no route on the site returns visitor-controlled text as JavaScript. None does; the processor's replies are JSON, errors and a PDF with `nosniff`.
3. **Inline styles written as text are refused.** A third-party component that injects a `<style>` element would need its own review; none is used. Advertising and analytics (M9) must be reviewed against this policy first, as document 05 section 13 says.
4. **The built-in 500 page** shows unstyled (decision 9).
5. **The policy is not exercised on the development server** (decision 5).
6. **Old browsers.** A browser too old to support Content Security Policy ignores all of it and gets no protection from it, though the site works. None of the supported browsers is in that group.
7. **Coupled to how Next.js writes pages.** If a Next.js update put per-request content in a prerendered page, the header test in `security-headers.spec.ts` (every inline script in the served page must be named by that response's policy) fails, which is the intended alarm.

## M8 checklist created by this record

- Ship `.next/csp-manifest.json` with the build (with `output: "standalone"` it must be added to the traced files), or set `CSP_MANIFEST_PATH`. Without it every page fails to start (decision 4).
- The edge must pass the app's headers through unchanged, and must not add scripts, styles or frames of its own without a policy review.
- Add `Strict-Transport-Security` and, with it, `upgrade-insecure-requests` at the HTTPS edge.
- Smoke test after each deploy: request every route and check that the policy names every inline script, as `security-headers.spec.ts` does against the local build.
- Decide on violation reporting together with monitoring.
- Optional: re-measure `Cross-Origin-Opener-Policy` on a real Firefox (decision 11) before ever adding it back.
- M9: review advertising and analytics against the policy before they are added.

## Consequences

- An attacker who finds a way to put markup into a page cannot run a script, load another site's code, send data to another site, rewrite the page's links, or frame it, in a browser that enforces the policy.
- A worker that reads a document cannot send it away, even if the reader has a flaw.
- A change that would break the policy (an inline style, a handler, an off-site resource) fails the build with the page and the reason.
- Pages stay prerendered and cacheable.
- New cost: one build step, one proxy file, and a rule that pages carry no inline styles.
