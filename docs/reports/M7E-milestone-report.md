# M7E Milestone Report: Accessibility

**Date:** 2026-10-23
**Status:** Accepted by the Product Owner on 2026-10-23; merged (`1a8d5b0`)
**Preceding slice:** M7D — bad-input matrix (accepted and merged, `2a7197c`; main's CI on that commit passed in all five browsers).
**Part of:** M7 QA and hardening (governance §14.3), slice E of seven.
**Decision record:** [ADR-036](../adr/036-m7e-accessibility.md).

## Summary

Every page, and every state of every tool, is now tested the way four kinds of visitor meet it: by automated rules, with only a keyboard, as a screen reader's accessibility tree presents it, and with enlarged text on a narrow screen. Five real problems turned up and are fixed. The test is part of the suite, so a change that breaks any of them fails the build.

Nothing changes for what a tool produces. The page looks the same except that Remove PDF Metadata's result table now has borders and scrolls inside itself on a small screen.

## What I found, and what changed

1. **Reorder buttons whose spoken name did not contain their visible words** (WCAG 2.5.3, level A). The buttons read "Move earlier" but were named "Move page 2 earlier". Voice-control users who say what they see missed them. Now "Move earlier, page 2". Organize, Images to PDF and Merge.
2. **Text cut off at 320 px with large text.** The status words in a page thumbnail ("Rendering preview…", "Preview unavailable") were clipped in a surface 124 px wide. They now wrap.
3. **Long words and fixed columns ran off the side** at 320 px with text doubled: the tool guides, the contents links of the Learn guides, every field-group legend (Compress, Images to PDF), Compress's option text, the Rotate result rows, and Compress's result list (a 9 rem column minimum that doubles with the text). Fixed in the stylesheet; the rest of the site already used the safe form. My machine's default font is narrower than CI's, so CI found four of these that I could not see; the test now measures in a wide font so both agree.
4. **Remove PDF Metadata lost keyboard focus** when it changed state (every other tool moves focus to the new heading), had a table with no layout that ran off a narrow screen with no way to scroll it by keyboard, and hid its caption with a Tailwind class used nowhere else. It now moves focus, scrolls the table inside a labelled, focusable region, and uses the site's own hidden-text class.

5. **Split's page-range field was 320 px tall on phones** (a width setting read as a height once the layout becomes a column). Found because mobile WebKit's focus check reported it covering other text; it is one line tall again and the test now flags a one-line field taller than 120 px.

Everything else held: no unnamed controls, no unreachable or trapped controls, no hidden or low-contrast focus, no field error without its message, no touch target under 24 px, no missing title, language or landmark, and no axe violation, on every state reached.

## What the test checks, in every state

- **Rules:** axe with WCAG 2.0 to 2.2 A and AA and best-practice rules, plus Label in Name.
- **Keyboard:** Tab through the whole page and round again; every control is reached, focus never sticks, is never covered, never invisible, and its outline contrasts at least 3:1; error fields are tied to their message; targets are at least 24 × 24 px (WCAG 2.5.8).
- **Screen reader:** every control has a name in the browser's accessibility tree; focus is kept or moved sensibly after an action; a state that says something new is announced.
- **Enlarged text:** in a wide font, at 320 px, at 320 px with text doubled, and with the WCAG text-spacing settings: no sideways page scroll, no text cut off, and anything that scrolls inside the page can be scrolled by keyboard.

## Verification

- **The matrix:** 15 tests per browser project covering 70 states: the ten PDF tools, Images to PDF, Word to PDF (scripted server), the pages without a tool, the 404 page, and the site-wide title, language, landmark and skip-link check.
- **Local, desktop and phone Chromium:** 28 of 30 pass. The two failures are PDF to JPG's result state, unreachable in this environment (the same PDF to JPG tests fail on unmodified `main` here); CI is authoritative.
- **The whole existing suite, same two projects:** 396 pass, 32 fail (16 per project): the 8 that fail on unmodified `main` here, the 7 password-protected M7D cases (same cause, passing on CI), and the PDF to JPG state above. The tests that press the renamed buttons (Merge, Organize, Images to PDF, merge privacy) pass.
- **Unit tests:** 420 pass. Lint, types, format and the production build pass.
- **The tests can fail.** I broke nine fixes one at a time (reorder name, Remove Metadata focus, thumbnail text rule, Compress grid, Split error description, table keyboard access, control height, Learn link rule, Split field height). Every one was caught, each by the check named for it. The table one was not caught until I added a "scrolls but a keyboard cannot reach it" check, which now exists. Each was restored and the matrix confirmed.
- **Faults in my own test** (listed in the ADR) were found and fixed in the test, not in the pages.
- **Five-browser CI:** all five browsers pass on the last code commit (`b71d5c4`): desktop and phone Chromium, Firefox, WebKit and phone WebKit, 214 tests each, which includes PDF to JPG's result state and the password-protected cases that cannot run here, plus the processor tests, the processor container build and the web quality job (with the dependency audit). The first CI runs found what my machine could not: four overflows at 320 px with large text (CI's default font is wider than mine), Firefox keeping focus on the last control, and mobile WebKit's report of Split's 320 px tall field. All are fixed above. The commits after `b71d5c4` change only the two records.
- **Not verified:** real screen readers (VoiceOver, TalkBack, NVDA, JAWS), real phones, browser zoom and the system text-size settings, forced-colours mode (all M7G); PDF to JPG's result and the encrypted-PDF cases locally (CI decides).

## Known limitations

1. **No real assistive technology.** The test proves the right things are named, focused and announced; it cannot prove how a screen reader speaks them. M7G.
2. **The shared error region is wide.** The tool shell wraps its whole error area in `role="alert"`, so a screen reader reads more than the message. Verbose, not wrong; left for real screen-reader testing to decide.
3. **Text size is simulated** (root size doubled, WCAG spacing), not taken from a real browser or phone setting.
4. **No forced-colours check.** Focus is drawn with an outline, which browsers keep in that mode. Device check, M7G.
5. **axe cannot see text on images or in canvases.** The pages use none for meaning.

## Deviations from plan

- The plan listed the work as tests. It also changed code, because the tests showed four real problems; each change is small.
- My first mutation pass was invalid: a run that timed out left a test server on the port and the other six did not run. I noticed because the logs said so, repeated the pass from the start, and it caught all seven.
- **Unrelated dependency fix.** A new high-severity advisory on `zod` (memory exhaustion; reached only through the lint tooling, nothing shipped) made the CI audit step fail on this branch and would on `main`. I pinned the patched release, 4.6.7, in `pnpm-workspace.yaml` the way earlier advisories were handled, as its own commit. Lint, types, 420 unit tests and the build pass with it. Two moderate Vitest advisories remain (below the audit's threshold); the Vitest bump stays a follow-up.
- A broken state no longer stops the matrix (decision 6 in the ADR): I added that after PDF to JPG's unreachable state hid the scene after it.

## Decisions

1. **M7E accepted** — for you to say. I will not merge until you do.
2. **Reorder button names** now start with the visible words ("Move earlier, page 2"). Engineering call; the visible text is unchanged.
3. **Open for the M7G checklist:** a real screen reader on one tool per kind (picker, list reorder, result, error), real phones with the largest text size, and forced-colours mode.
4. **Branches.** The 21 throwaway `check/` branches from M7C are still on GitHub; deleting them is not possible from this session.

## Recommended next

**M7F — performance budgets.** Measured budgets for page weight, start-up and the heaviest local operations. I will not start it until you say so.

## Files

- Test: `apps/web/e2e/a11y-matrix.spec.ts`.
- Reorder names: `packages/ui/src/reorder-controls.tsx`, `apps/web/components/merge/merge-workspace.tsx`, and the tests that find the buttons: `apps/web/e2e/{merge,organize,images-to-pdf,merge-privacy-lifecycle}.spec.ts`, `apps/web/e2e-foundation/pages.spec.ts`, `apps/web/benchmarks/run-organize.mjs`.
- Layout: `packages/ui/components.css`, `apps/web/app/globals.css`.
- Remove PDF Metadata: `apps/web/components/remove-pdf-metadata/remove-pdf-metadata-workspace.tsx`.
- Records: `docs/adr/036-m7e-accessibility.md`, this report; M7D's merge recorded in ADR-035, the ADR index, the M7D report and the governance M7 row.
