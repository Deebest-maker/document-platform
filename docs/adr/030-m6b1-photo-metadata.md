# ADR-030: Photo metadata in Images to PDF, and availability copy taken from the registry (M6B.1)

**Status:** Implemented as a follow-up to M6B, on the owner's instruction to fix what needed fixing; owner acceptance pending
**Date:** 2026-10-22
**Scope:** (1) Images to PDF no longer copies the metadata stored inside a JPEG into the PDF. (2) Site copy about how many tools are available and where they process files is read from the tool registry, and the wrong statements found are corrected. No new dependency, route, endpoint, storage or analytics. Server retention is not changed.
**Relates to:** ADR-017 (Images to PDF), ADR-020 (Remove PDF Metadata), ADR-023 and ADR-024 (Word to PDF retention), ADR-029 (the finding that led here), AGENTS.md ("processing-mode labels must match actual behavior").

## Context

Two defects surfaced while the M6B guides were checked against the product.

**Photo metadata.** A JPEG that needs no rotation was embedded in the PDF with its original bytes (ADR-017). The PDF library embeds the whole file, so everything stored in the photo went into the PDF: camera make and model, the GPS position, XMP and IPTC records, comments, and anything a camera appends after the picture. I confirmed it with a test photo: every marker string was present in the generated PDF. Remove PDF Metadata does not help, because the data sits inside the image stream, not in the PDF's own fields. For a privacy-first tool this is a surprise a user would not expect and could be hurt by (a photographed document with its location attached). ADR-017 said the application does not "preserve image metadata", which was true only for rotated images.

**Site copy.** The Tools page said "Eleven tools are available" when twelve are. The Privacy page said the eleven available tools process everything in the browser and that server details must be disclosed "before server tools become available", although Word to PDF is available and uploads files. The Home page labelled the server mode "Planned" with "No document can be uploaded here". About listed ten of the eleven on-device tools and called server processing a future matter. Terms and the footer repeated the count by hand. These were true when written and went stale as tools were added.

## Decision

### 1. Remove the metadata block from a JPEG, leave the picture bytes alone

`packages/pdf-browser/src/jpeg-metadata.ts` (`stripJpegMetadata`, about 150 lines, no dependency) walks the JPEG's marker segments and writes a new file made of:

| Part                                                                             | Treatment                                                      |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Frame, quantization and Huffman tables, restart interval, scan header, scan data | Copied byte for byte, so the decoded pixels are identical      |
| APP0 JFIF header without a thumbnail                                             | Kept (viewers use it for density)                              |
| APP14 Adobe                                                                      | Kept (decoders need it to read CMYK and YCCK colour correctly) |
| All other APP1 to APP15 segments (EXIF, GPS, XMP, IPTC, ICC, MPF, JFXX, vendors) | Dropped                                                        |
| COM comments                                                                     | Dropped                                                        |
| Anything after the first end-of-image marker (appended previews, second images)  | Dropped                                                        |

Progressive files, restart markers and byte-stuffed `0xFF` data are handled by skipping segments by their declared length and treating entropy data as opaque, so image data is never mistaken for a marker. A file cut short keeps all its bytes.

Where it applies in `createImagesPdf`: an unrotated JPEG is stripped and then embedded. A rotated JPEG was already redrawn on a canvas and written as a new file, which has no metadata. PNG pixels go through pdf-lib's decode and re-encode, which drops text, EXIF and colour-profile chunks (a test now pins this). The embedded picture is unchanged in every case where pixels were not already being re-saved.

**If the stripper does not understand a JPEG's layout**, the picture is redrawn through the existing canvas path instead of being rejected or embedded as it is. The browser has already decoded the file at that point, so it is usable; a redrawn picture carries no metadata by construction. This costs a re-save for such files (the same one a rotated photo gets) and never leaks. A file the browser cannot decode at all is rejected earlier, as before.

### 2. The colour profile is dropped too

An embedded ICC profile (APP2) is removed along with the rest. PDF viewers take the colour space from the PDF image dictionary and are expected to ignore a profile inside the JPEG stream, so removing it should not change what a viewer shows (Poppler renders both versions identically; I did not check Acrobat or other viewers). Profile descriptions can also name the device that made the picture. The guide therefore does not claim the colour profile is kept.

### 3. Alternatives considered

| Option                                      | Why not                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leave it and warn (the M6B state)           | The tool would keep putting location data into files people share. A warning is not a fix.                                                                                      |
| Redraw every JPEG on a canvas               | Re-saves the pixels (visible loss on every photo), costs memory on large pictures, and ADR-017 already records browser differences in canvas export. Used only as the fallback. |
| A metadata library (for example `piexifjs`) | A new dependency for a small, well-specified operation; most such libraries edit EXIF only and would leave XMP, IPTC, comments and trailing data.                               |
| Remove EXIF only                            | Leaves XMP, IPTC, comments, maker notes in other segments and appended data, which carry the same details.                                                                      |

### 4. Availability copy is derived, and tested against the registry

`apps/web/lib/availability.ts` reads the registry and produces the counts and sentences: the banner and footer line, the Tools page notice and description, and the number words used on Privacy, Terms and Home. Mode labels on Home and Privacy come from `getModeAvailability`, so a processing mode is called "Planned" only while no available tool uses it. About lists the on-device tools from the registry.

The Privacy page now has a section for the one tool that uses the server and states only what the product does: the Word file is uploaded over an encrypted connection, the tool says so before the upload, the server copy is deleted once the PDF has reached the browser (ADR-023), and files from abandoned conversions are deleted automatically after a short time. **It states no retention period.** The period is still the open owner decision (A 15 min today, B 10 min, C 5 min), and the page says the exact period is not finalized.

`apps/web/tests/site-copy.test.tsx` compares the rendered pages with the registry: the Tools notice, the banner and footer, every server tool named on About, Home, Terms and Privacy, every on-device tool named on About, the Privacy claims, the mode labels, and a sweep that fails if any page says "N tools" or "N tools are available" with a number the registry does not support. I confirmed the sweep fails on the old text ("Eleven tools are available").

## Evidence

- **Unit tests (21)** for the stripper on baseline, progressive, grayscale, CMYK-with-Adobe and restart-marker files: clean files come back byte-identical; with EXIF, XMP, IPTC, comment, ICC, MPF, JFXX, an unknown APP10, trailing data and a fake second image injected, the output equals the original clean file; the function does not change its input and is idempotent; malformed input throws.
- **PDF-level tests (7)** through `createImagesPdf`: none of the marker strings survive for JPEG (and for PNG text and EXIF chunks); the clean JPEG bytes appear unchanged in the PDF; a mixed batch works; a JPEG the stripper cannot follow is redrawn, not embedded; a JPEG it can clean is never redrawn. A control shows that a plain `embedJpg` does leak the same data.
- **Browser test (1, two projects)**: a photo with EXIF, XMP, IPTC, comment and trailing data is added on the real page; the downloaded PDF contains none of the five markers.
- **Independent tools.** Two camera-style JPEGs (baseline 6,005 B and progressive 4,873 B, with EXIF Make, Model, Software and GPS, an sRGB ICC profile, a comment, XMP and trailing data) were processed and read back with Pillow: decoded pixels are identical, EXIF tags 4 to 0, GPS, ICC, comment and XMP all gone, none of six marker strings left, the file ends with an end-of-image marker, and the progressive file is still progressive. PDFs built from the originals contain all six strings; PDFs built from the stripped files contain none; Poppler (`pdftoppm`, 72 dpi) renders each pair pixel-identically.

## Not covered, and limits

1. **Only Images to PDF.** Other tools do not change images that are already inside a PDF, and Remove PDF Metadata does not touch them. The Remove PDF Metadata guide now says a photo placed in a PDF can still carry its own camera details.
2. **Pixels can still identify.** Faces, number plates and visible text in the picture are not metadata and are not touched.
3. **Test photos are synthetic.** Fixtures were made with Pillow and injected segments. I did not have real phone and camera files. Maker-specific layouts (motion-photo trailers, depth maps, multi-picture files) are covered by the "drop other APPn, truncate at the first end-of-image marker" rule, but they should be tried with a few real photos in M7.
4. **The PDF's own fields.** The generated PDF carries the producer and creation date written by the PDF library, as before; this change does not alter that.
5. **Retention is unchanged.** Nothing here chooses between 15, 10 and 5 minutes.

## Consequences

- Images to PDF output is a little smaller for photos that carried metadata (937 bytes in the test pair).
- The Images to PDF guide now says only the picture goes into the PDF, and a guide test fails if it ever claims otherwise. ADR-017's remark about metadata is now true for every image.
- Adding a tool or changing a tool's processing mode changes the site wording automatically, and the test suite shows which statements need a human decision.
- A future server tool must be named on About, Home, Terms and Privacy for the tests to pass, which is the intent.
