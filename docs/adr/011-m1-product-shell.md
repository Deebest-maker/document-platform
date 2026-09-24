# ADR-011: M1 product shell

Date: 2026-09-24

Status: Accepted within the user-approved M1 plan and architecture amendments

## Context

Roadmap M1, E02/E03 and DEV-004/005/006 introduce discovery and presentation before M2 processing. The user explicitly approved one nonfunctional Merge preview and refined privacy wording. ADR-010 remains the foundation; no processing or infrastructure decision is expanded.

## Decisions

- A private, plain TypeScript `packages/tool-registry` owns the 13 documented MVP records, categories, current planned processing modes, accepted-type descriptions, related slugs, featured selection, page availability, privacy explanations, and small path/search/metadata selectors. It has no React, Next.js or network dependency.
- Slugs follow the SEO plan, including `/jpg-to-pdf` for Images to PDF. Each record has one primary discovery category; Extract PDF Pages belongs to Extract and is related to the page-organization tools.
- LOCAL/SERVER/HYBRID represent the approved current MVP intent. PDF to JPG and PDF to Text are currently LOCAL; Compress is HYBRID; both Office conversions are SERVER. This does not forbid a future reviewed fallback. Any mode change affects the privacy contract and requires explicit review.
- All tools remain unavailable. The registry distinguishes a planned catalog entry from a page preview, not working processing. Every indicator is qualified as planned; there is no independent per-page privacy-label property.
- M1 deliberately uses neutral **Server processing**, refining the UX baseline's **Secure server processing**. The user explicitly approved this wording until the documented server security and lifecycle controls are implemented and verified. No encryption, retention, deletion or certification guarantee is made.
- Only `/merge-pdf` receives a tool route. Its metadata and ToolShell content come from the Merge record. It stays noindex and has no picker, fake upload zone, simulated progress, result, download action, or processing request. Other records link to catalog anchors; no bulk placeholder routes are generated.
- `packages/ui` gains only ToolShell, PrivacyIndicator and their CSS. ToolShell uses presentation slots for idle/selected/processing/result/error; non-idle states are exercised with synthetic test content only. It owns no files, engines, requests or job state.
- Pages, navigation and descriptive content use Server Components. ToolDiscovery alone declares a client boundary for in-memory search/category state. The plain ToolList can render within either boundary. Native disclosure controls need no custom event logic. Queries are not placed in URLs, persisted, logged or sent to a search service.
- Trust routes are lightweight and qualify unfinished policy/contact copy. Final branding, Learn, production indexing/canonical domains, sitemap and structured data remain deferred.
- Keep the existing web ESLint configuration in place. Its command changes working directory to the repository root and explicitly targets web/UI/registry source; ignore patterns and Next rootDir are adjusted to that base. No root configuration or tooling relocation is necessary.
- Extend the existing web TypeScript/Vitest runners to the shared source and consumer contract tests. Next consumes private workspace TypeScript sources directly. Add only the approved test adapter `@axe-core/playwright@4.13.0` (MPL-2.0).

## Consequences and verification

The UI remains a product preview, not a public launch or a functional document tool. Native controls, system fonts and existing neutral tokens keep the shell small. Browser tests check registry-driven discovery, qualified modes, keyboard paths, noindex, real 404s, no processing controls, reflow, and unexpected network requests. Axe complements manual visual/keyboard checks; it is not a full WCAG conformance assessment.

M1 retains desktop/mobile Chromium smoke coverage under the approved plan. The QA strategy's expanded release browser matrix and document-fixture coverage remain future hardening work. Required CI job identifiers remain unchanged.

Browser journeys are independently named to keep failures attributable. Local verification uses one worker and CI uses two, bounding browser memory use after concurrent local audits exhausted test timeouts. All assertions, the default 30-second test timeout, zero retries, and both Chromium projects are retained.

## Traceability

- Roadmap §§2–6: M1, E02/E03, DEV-004/005/006; DEV-007 onward is excluded.
- PRD §§8–10; SRS FR-GEN-004/011, FR-PRV-001/002/005/006, NFR-A11Y-001–006, and SEO presentation foundations.
- Architecture §§4, 6–7; Security/Privacy §§4, 9, 12–13.
- UX §§2–8, 14, 17–22; QA §§2–3, 6, 9, 12.
- The M1 implementation approval with architecture amendments is the authority for the preview, neutral privacy copy, and restricted milestone scope.
