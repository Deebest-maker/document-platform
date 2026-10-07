# ADR-017: local Images to PDF vertical slice

## Status

Implemented under the approved M3B.1 scope; owner acceptance pending.

## Context

M3B.1 requires the documented `LOCAL` Images / JPG to PDF workflow: accept JPEG and PNG files, preview and arrange them, place one image on each PDF page with explicit layout choices, and publish a validated fixed-name download. The architecture forbids document upload, persistence and document-derived telemetry. The approved implementation gate also requires evidence for EXIF orientation, decoded-memory limits, bounded lifecycle and browser compatibility without adding a production dependency unless separately reviewed.

## Decision

- Keep the shared `FilePicker` and shared reorder control small. The route owns image-specific cards, preview state and copy; the only shared UI change lets reorder controls receive an accessible item label.
- Inspect PNG/JPEG signatures and dimensions locally before decode. Parse the JPEG EXIF IFD0 orientation tag internally. Because worker canvas export and EXIF decode behavior differ across browser engines, remove the EXIF APP1 segment and normalize an oriented JPEG once in a route-owned canvas before it becomes ready. The temporary full-size bitmap is closed immediately; the normalized encoded Blob is passed to the PDF worker. Unoriented images retain their original encoded bytes.
- Generate sequentially in one dedicated route worker using the already reviewed `pdf-lib@1.17.1`. One image produces one page. Auto uses 96 CSS pixels per inch mapped to 72 PDF points; A4 and Letter use exact physical point sizes. Contain is the default; Cover is disclosed as cropping. Page orientation is Auto, Portrait or Landscape.
- Draw an opaque white page before every image so transparent PNG regions have deterministic white backing. Reopen the completed PDF and verify page count and geometry before exposing a fixed `images-to-pdf.pdf` download.
- Apply conservative registry limits before and during work: 20 files, 10 MiB each, 32 MiB compressed total, 8192 pixels per side, 24 MP and 96 MiB estimated RGBA per image, 160 MP and 640 MiB aggregate decoded estimate, and 64 MiB output. Preview generation is sequential and bounded to 320 pixels. Generation cancellation terminates the worker; reset/navigation revoke every owned Blob URL.
- Add no dependency, server route, persistence, analytics, drag library, alternate PDF engine or source-derived output filename.

## Consequences

Header, geometry, operation, session and browser tests cover supported formats, malformed/mismatched inputs, size/pixel/count bounds, stable order, EXIF orientations, exact Auto/A4/Letter pages, contain/cover behavior, output validation, cancellation, URL/worker cleanup, privacy, accessibility and desktop/mobile behavior. The expanded browser matrix checks Chromium, Firefox and WebKit families. Synthetic benchmark evidence records phone-size, mixed JPEG/PNG, 24 MP and 20-image workloads. Cross-browser testing specifically rejected a worker-only EXIF path after WebKit lacked the required canvas-export behavior; the bounded route normalization is the tested compatibility path.

The application does not color-manage images beyond browser decoding, preserve image metadata, or promise print-production fidelity. Re-encoding EXIF-oriented images can change compression details. Physical low-memory mobile testing remains a launch gate; the conservative limits are engineering controls rather than a permanent product promise.
