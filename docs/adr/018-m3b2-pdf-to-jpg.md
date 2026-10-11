# ADR-018: local PDF to JPG rendering

## Status

Implemented under the approved M3B.2 scope; owner acceptance pending.

## Context

M3B.2 requires a `LOCAL` PDF to JPG workflow that reuses the M2B preview document, preserves effective page orientation, supports all or selected pages at explicit DPI presets, and exposes either one JPG or an atomic ZIP. Documents, page images and source-derived metadata must remain in the browser. Rendering and packaging must remain bounded and cancellable without adding a second PDF engine or loading PDF assets on unrelated routes.

## Decision

- Extend the existing route-owned PDF.js `PreviewDocument` with a full-page JPEG render operation. The same loaded document and single native worker serve preview and export; the thumbnail scheduler pauses while full-page pages render sequentially.
- Offer 96, 150 and 300 DPI, with 150 DPI as the default. Output pixels use `round(points × DPI / 72)`. PDF.js applies the page crop box and source rotation, and every render starts with an opaque white background. JPEG quality is fixed at 0.9 so the interface does not imply unsupported quality guarantees.
- Keep stable page identities in the shared page plan. Explicit selections are filtered through source order. One page is returned directly as `page-NNN.jpg`; multiple pages use the existing dynamically imported `fflate@0.8.3` and fixed `pdf-pages-jpg.zip` name.
- Validate every JPEG signature, frame dimensions and browser decode before publication. Reopen a generated ZIP and verify its complete fixed-name inventory and entry sizes. A failed or cancelled page invalidates the complete batch and creates no result URL.
- Enforce preflight and runtime bounds: 50 selected pages, 25 MP and 100 MB estimated RGBA per page, 220 MP aggregate, 64 MB combined JPG data, and a 64 MB archive. Revoke the sole result URL and release canvases, bitmaps, render tasks, page proxies and the shared worker on reset or navigation.
- Add no dependency, server route, upload path, persistence, analytics, user-controlled output name or alternate renderer. Keep PDF.js, OFL font and archive assets lazy and first party.

## Consequences

Unit and browser tests cover DPI geometry, source ordering, direct and ZIP output, malformed and encrypted inputs, atomic failure, cancellation, output validation, privacy, accessibility and lifecycle cleanup. The benchmark covers mixed pages, a rotated 300 DPI page and the 50-page boundary with one worker and one result URL. Independent Poppler crop-box renders match output geometry and show normalized mean pixel differences of 0.34%–0.61%, attributable to rasterizer antialiasing and JPEG encoding.

The browser JPEG encoder determines exact compressed bytes, so identical PDFs can produce different byte streams across engines. The current limits are measured engineering controls, not public performance guarantees. Physical low-memory mobile verification remains a launch gate.
