# M7C Milestone Report: Web security headers and Content Security Policy

**Date:** 2026-10-22
**Status:** Implemented; owner acceptance pending
**Preceding slice:** M7B — processor abuse controls (accepted and merged, `39d954d`); CI reliability follow-up merged as `8591805`.
**Part of:** M7 QA and hardening (governance §14.3), slice C of seven.
**Decision record:** [ADR-034](../adr/034-m7c-web-security-headers-csp.md).

## Summary

The site now tells the browser what a page is allowed to do. Before this slice it sent no security headers. Now every page carries a Content Security Policy that lets the browser run only this site's own scripts, and every file the tools use to read a document in the background carries a stricter one that lets nothing leave the browser. If someone ever found a way to put markup or script into a page, the browser would refuse to run it, load another site's code, or send data to another site.

Nothing changes for a visitor. Every tool journey that can run in this environment ran under the policy with no refusals.

## What was implemented

- **A page policy, per page.** Scripts from this site only, plus the page's own inline scripts by hash. No `unsafe-inline`, no `unsafe-eval`, no other origin for anything. Images may also come from in-memory `blob:` and `data:` sources, which previews and results need. Frames, plug-ins, form posts and a `<base>` tag are not allowed.
- **A worker policy.** Every script file carries a policy that a background worker obeys: it can run this site's scripts and WebAssembly (the PDF reader needs it) and fetch this site's own data files, and cannot reach any other address. A document opened in a worker cannot be sent away.
- **Plain headers on every response:** `nosniff`, no referrer, no framing (`X-Frame-Options: DENY` and `frame-ancestors`), and a `Permissions-Policy` that switches off camera, microphone, location, payment, USB and sensors. The Word to PDF server's own replies keep their own headers (M7B) and are not doubled.
- **A build step** that finds each page's inline scripts, hashes them and writes the list the policy uses. It also reads every built page and fails the build, naming the page, if it contains something the policy would refuse: an inline style, an event-handler attribute, a `javascript:` link, a frame, or anything loaded from another site.
- **Fail closed.** If that list is missing, no inline script is allowed, the pages do not start, and the server logs the reason once.
- **The site's own 404 and error pages.** Next.js's built-in ones style themselves inline, which the policy refuses. The 404 page is now a normal page of the site with links back to the tools.

## Why hashes and not nonces

A nonce has to be new for every response, which would mean building every page on request: no static pages, no caching, a bigger server. Hashes keep the pages prerendered. Allowing all inline scripts would have made the policy useless against its main target.

## Verification

- **Web unit tests:** 391 pass (95 new): the build step, the policy loader, the policy text, which responses get which headers, the proxy, and the 404 and error pages. **Library tests:** 303 pass. Format, lint, types and the production build pass.
- **Browser tests:** 25 new in each browser project: 8 on the headers the server really sends (every page's policy names exactly the inline scripts that page contains), 5 that try to break the policy (injected script, handler, eval, off-site fetch, script and image, frames, form posts, `<base>`, blob workers, inline styles; and a worker started from the real script file that cannot send data away), and 12 that give every tool five hostile file names. Every existing browser test now also fails if the policy refuses anything.
- **Full run in desktop and phone Chromium:** 342 pass, 16 fail. The 16 are the same 8 tests per project that fail on unmodified `main` here (this environment runs Node 22; the project requires Node 24). I confirmed that by running them on `main`.
- **The tests can fail.** Checking this found a weak test of mine: the first framing test passed whether or not the headers were there (Chromium blocked its made-up test page for an unrelated reason). It now uses a real second site and a control, and fails when the framing headers are removed. I weakened the policy 15 ways, one at a time, and each was caught by at least one unit test and one browser test. Making a tool render the file name as HTML was caught. Writing the build check's tests found a hole in my first version, which I fixed.
- **A worker cannot send a document away.** A worker started from the real script file with hostile code in it sends data off-site without the policy header and cannot with it.
- **The Word to PDF server's replies** keep their own headers once each, checked live behind the production server.
- **Five-browser CI run on the final commit:** desktop and phone Chromium, Firefox, WebKit and phone WebKit all pass, including the 8 tests that cannot run here. Two extra Firefox-only runs of the whole suite, each run twice, had no failure. This run found three problems, all in tests or in one header (see Deviations).
- **Not verified:** real Safari, real Firefox and phones (M7G); behaviour behind a real HTTPS reverse proxy or CDN (M8); the 8 tests per project that cannot run in this environment.

## Known limitations

1. **Real Safari and Firefox, and phones,** are checked by hand in M7G. CI runs the same tests in Playwright's Chromium, Firefox and WebKit.
2. **The development server has no page policy.** It needs `eval` and inline scripts for hot reload. The browser tests run against a production build.
3. **Next.js's own "500: This page couldn't load" page** cannot be replaced from the app; under the policy it shows as unstyled text. It holds no document data and only appears after a server failure. The build check makes one documented exception for it.
4. **Local runs still show the 8 failures per browser project** (recovery and image-export tests) that fail on unmodified `main` in this environment. I ran them on `main` to confirm they are the same ones. CI is the authority.
5. **Not covered here (M8):** HSTS and `upgrade-insecure-requests` at the HTTPS edge, shipping the policy list with the deployed build, violation reporting, and a deploy smoke test. They are on the checklist in the ADR.
6. **Advertising and analytics (M9)** will need a policy review before they are added.

## Deviations from plan

- **Own 404 and error pages** were not in the plan. They were needed: the built-in ones cannot run under the policy.
- **`Cross-Origin-Opener-Policy` was in the plan and is out.** Firefox stalled page loads for 30 seconds in about one test in a hundred with it on, and never without it (ADR-034, decision 11). It protected little here, since the site opens no windows.
- **Test fixes found by the five-browser run.** WebKit's screenshot tool adds a style element the policy refuses, so the tests set aside exactly one such refusal per screenshot (WebKit only, unit tested). Firefox reports a blocked form by throwing; the test now accepts that. The framing test had passed whether or not the headers were present, because Chromium blocked its made-up test page for an unrelated reason; it now uses a real second site and a control, and fails when the framing headers are removed.
- **`Referrer-Policy: no-referrer`** is a choice the plan left open; it is a one-line change if advertising later needs otherwise.

## Decisions needed from the Product Owner

1. **Accept M7C**, or tell me what to change.
2. **Referrer policy.** `no-referrer` is the strongest and fits the privacy position. Say so only if you want the browser default instead.

## Recommended next

**M7D — bad-input matrix.** Every tool against corrupt, encrypted, empty and mislabelled files and hostile file names, plus a DOCX that expands enormously when unzipped. I will not start it until you say so.

## Files

- Policy and headers: `apps/web/lib/security/policy.mjs` (+ `.d.mts`), `apps/web/lib/security/document-policy.ts`, `apps/web/proxy.ts`, `apps/web/next.config.ts`.
- Build step: `scripts/csp-manifest.mjs` (+ `.d.mts`); `apps/web/package.json` (`build`).
- Pages: `apps/web/app/not-found.tsx`, `apps/web/app/global-error.tsx`.
- Tests: `apps/web/tests/{csp-manifest,document-policy,security-headers,proxy,error-pages}.test.*`, `apps/web/tests/types/next-path-to-regexp.d.ts`; `apps/web/e2e/{security-headers,csp-enforcement,hostile-content}.spec.ts`, `apps/web/e2e/fixtures.ts`.
- Documents: `docs/adr/034-m7c-web-security-headers-csp.md`, ADR index, governance M7 row.
