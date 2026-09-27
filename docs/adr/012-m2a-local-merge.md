# ADR-012: M2A LOCAL Merge PDF

Date: 2026-09-25

Status: Implemented within the approved M2A architecture amendments; milestone acceptance remains with the owner.

## Authority and scope

The current M2A approval splits Roadmap M2 into Merge (M2A) and a separately reviewed preview/page-operation foundation (M2B). This refines ADR-011's unavailable Merge preview only. ADR-010's workspace, health-only processor and required CI jobs remain intact. Traceability: FR-MRG-001–004, applicable FR-GEN file validation/error behavior, FR-PRV-001/005/006, NFR-A11Y-001–006, Roadmap DEV-007/008/009/010 and the approved M2A amendments.

## Decisions

- `packages/pdf-browser` exclusively integrates pinned `pdf-lib@1.17.1`. It has no React, Next.js, network or persistence dependency. Its asynchronous `mergePdfs(inputs, limits, {signal, onPhase})` returns a Blob, page count and input count. Validation covers selection count, bytes, PDF header, strict parsing, encryption, nonempty page trees, total pages, output bytes and reopening the saved result.
- Input PDFs are read sequentially. A single copier per input copies every page in selected-file order, preserving page order, dimensions and rotations without rasterization. Originals are not mutated. Any failure discards the partial destination; no partial download exists.
- Initial main-thread measurements triggered the explicitly approved worker condition: image-heavy cases repeatedly caused long tasks under a page CPU throttle. Use one native module worker per operation behind the same asynchronous interface. Heavy library code is loaded only when Merge is invoked. Completion, failure and cancellation terminate the worker. There is no silent main-thread fallback. A user can cancel an unusually slow job; byte/page caps are not a hard browser memory bound.
- The browser adapter sends only plain Blobs, opaque selection IDs and numeric limits to the worker, never filenames. These are local structured messages, not requests. Worker-only console methods discard dependency parser diagnostics because pdf-lib can warn with document-derived values. Errors crossing this boundary contain finite safe categories and optional selection IDs; raw exceptions and stacks are never retained or surfaced. No application-wide console suppression is used.
- `apps/web` owns one route-local session instance, selected File objects, ordering, abort controller, current result and its Object URL. No document values enter Server Components, server actions, URLs, backend handlers, telemetry or persistent browser stores. The processor is uninvolved.
- A generation token protects every asynchronous continuation and phase notification. Only a current successful result creates a URL. Repeated downloads use that URL and the fixed filename `merged.pdf`. Edit/replacement, Start over, pagehide and unmount revoke it. Reset/unmount release retained input/result references; this is not secure memory erasure. Inputs remain during success only to support changing the selection/order.
- `packages/ui` adds only a generic accessible FilePicker. Selection validation, Merge state and engine code stay outside UI. Native buttons support choosing/adding files, remove, earlier/later, cancellation and recovery. Duplicate selections have independent IDs. Status text reflects actual phases, without fabricated percentages. Download is the primary result action.
- The registry owns accepted types, LOCAL mode, availability, privacy wording and current caps. Only Merge becomes available. Other 12 tools remain planned. Site copy reflects this distinction; all routes remain noindex and unfinished policy/contact pages remain qualified.

## Forms, signatures and limits

No speculative feature detector or blanket form/signature rejection is introduced. Synthetic AcroForm and genuine detached-CMS signature fixtures are accepted. Copying pages does not preserve the original document-level form tree or valid digital signatures; the UI discloses these limitations before processing and beside the result. Keep original files. Encrypted/password-protected files are explicitly unsupported and fail safely. This merge is not a sanitizer, form flattener, repair tool or signature validator.

The conservative **M2A engineering caps** are 20 files, 10 MiB per file, 32 MiB combined, 200 pages and 32 MiB output. They sit below the explored 40-file, 240-page and approximately 50-MiB image workloads. See [benchmark evidence](../benchmarks/M2A.md). They are not final public launch limits or speed guarantees. Broader device/browser and physical-mobile evidence is required before making launch claims.

## Verification and consequences

An independently authored synthetic manifest specifies exact identities, dimensions, rotations and order for A+B, B+A and C+B+A. Tests also cover duplicates, unchanged source hashes, atomic failures, validation, cancellation, stale completion, safe errors and URL lifecycle. Desktop/mobile Chromium runs the real worker workflow, validates downloads, audits context-wide requests/console events, proves a warmed offline merge, checks keyboard focus/reflow and axe rules. Independent PDF inspection complements these checks.

The existing `web`, `processor` and `processor-container` hosted jobs remain required and unchanged. Fixture-authoring Python libraries are optional existing local tools, not new production or CI dependencies. No PDF.js, previews, Split, Organize, page-level controls, server processing, accounts or persistence are added. M2B must receive its own approved plan after this slice's report.
