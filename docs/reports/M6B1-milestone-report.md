# M6B.1 Milestone Report: Photo metadata and copy accuracy

**Date:** 2026-10-22
**Status:** Accepted and merged (`3a51a25`).
**Preceding milestone:** M6B — Tool-page guides (accepted and merged, `b760cb3`).
**Decision record:** [ADR-030](../adr/030-m6b1-photo-metadata.md).

## Summary

You accepted M6B and asked for everything that needed fixing to be fixed. Two things did.

1. **Images to PDF no longer puts photo details into the PDF.** A photo's camera model, GPS position, XMP and IPTC records, comments and appended data used to be copied into the PDF. They are now removed, and the picture itself is not re-saved. A photo with location data was confirmed to leak before the change and to leak nothing after it.
2. **Site wording about the tools was wrong in several places and is now correct and checked.** The Tools page said "Eleven tools are available" (it is twelve). The Privacy page said every available tool stays in the browser and that server tools were still to come, but Word to PDF is available and uploads files. The counts now come from the tool registry, and tests compare every page with it.

I did **not** change the server retention period, because you have not chosen between the three options.

## What was implemented

- **`stripJpegMetadata`** (`packages/pdf-browser/src/jpeg-metadata.ts`, no new dependency): keeps the picture data and the segments a decoder needs, drops EXIF, GPS, XMP, IPTC, ICC, comments, vendor segments and anything after the picture. Used for every JPEG that does not need turning upright; turned JPEGs were already redrawn without metadata. A JPEG whose layout it does not understand is redrawn on a canvas rather than rejected or embedded as it is.
- **Registry-derived wording** (`apps/web/lib/availability.ts`): banner, footer, Tools, About, Terms, Home and Privacy take their counts and server-tool names from the registry. The mode explanations on Home and Privacy say "Planned" only while no available tool uses that mode.
- **Privacy page:** a new section on the one tool that uses the server, stating only what the product does; the open retention decision is stated as open, with no number.
- **About:** lists all eleven on-device tools (Compress was missing) and names Word to PDF as the exception.
- **Guides:** the Images to PDF note about photo details is replaced with what now happens; the Remove PDF Metadata guide warns that photos inside a PDF can keep their own camera details.
- **README and decision records:** README states twelve tools; ADR-030 added; ADR-029 and the M6B report marked accepted and merged; ADR-017 notes the change; governance M6 row updated.

## Verification

- **Library tests:** 303 pass (was 275): 21 for the stripper, 7 at PDF level.
- **Web tests:** 210 pass (was 194): 14 for the site wording, 2 for the guides.
- **Browser tests:** a new test adds a photo carrying EXIF, XMP, IPTC, a comment and trailing data on the real page; the downloaded PDF contains none of it. Images to PDF, tool guides, shell, discovery, SEO and accessibility specs pass in both browser projects (174 tests). The other browser specs: 92 pass and 14 fail. The 14 are the same 7 PDF recovery and image-export tests in two browser projects that also fail on unmodified main in this sandbox (Node 22 here, Node 24 required), so CI is the check that counts.
- **Independent check:** two camera-style JPEGs were stripped and read back with Pillow (pixels identical; EXIF, GPS, ICC, comment, XMP gone; progressive file still progressive). PDFs built from the originals contain all six marker strings, PDFs built from the stripped files contain none, and Poppler renders each pair identically.
- **The tests can fail:** a plain embed leaks the markers (control test); putting the old "Eleven tools are available" text back fails two wording tests.
- **Format, lint, types, production build:** pass.

## Security and privacy

- Fewer personal details leave the device inside generated files. No new data flows, endpoints, storage or analytics.
- The Privacy page now describes Word to PDF's upload accurately. It still promises no retention period, because that is undecided.
- Photo pixels can still identify people or places (faces, signs); only stored metadata is removed.

## Known limitations

1. Test photos are synthetic. Real phone and camera files (motion photos, depth maps, multi-picture files) should be tried in M7.
2. The embedded colour profile is dropped. Poppler renders the same; I did not check other PDF viewers.
3. Only Images to PDF changes. Photos already inside a PDF keep their data in every tool, including Remove PDF Metadata, and its guide now says so.
4. The Privacy, Terms, About and Contact pages are still draft wording and must be finalized before indexing is turned on.

## Deviations from plan

None. This is an unplanned slice, done on your instruction to fix what needed fixing.

## Decisions needed from the Product Owner

1. **Accept M6B.1**, so M6C can start.
2. **Server retention** for abandoned Word to PDF jobs: A 15 minutes (today), **B 10 minutes (recommended)**, C 5 minutes. Reply "B" and I will apply it with its tests and wording.
3. **Still open:** production domain and brand or author name (needed for M6D and launch); the final trust pages; Safari, Firefox and phone testing (a launch gate for M7/M8); reading the guides' copy.

## Recommended next milestone

**M6C — Learn hub** (about eight original guides linked to the tools), once you accept this. I will not start it until you say so.
