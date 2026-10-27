# M7G Device Checklist

**Date:** 2026-10-27
**For:** the Product Owner (or anyone with a real phone and a PC)
**Part of:** M7 QA and hardening, slice G. Release criteria: document 08 sections 3 and 10; the items earlier slices could not check without real devices (ADR-034, 035, 036, 037).
**Time:** the starred checks (★) take about 40 minutes on one phone and one PC. The rest are optional and add depth.

Everything an automated test can check is already checked in five browser engines on every merge. This list is only what needs a real device: a real phone's file picker, memory and screen, real Safari, and real assistive technology.

## 1. How to report

Reply in plain text, one line per check, with the device name first:

```
Device: Tecno Spark 10, Chrome 130 (Android 13)
A2 PASS
A6 FAIL: the ZIP would not open
G2 NOTE: the error was read twice
```

Use `PASS`, `FAIL` (with what you saw), `NOTE` (not a failure, worth knowing) or `SKIP`. Take a screenshot of any failure. A check that cannot run because something is missing is `SKIP`, not `FAIL`.

How serious a failure is (document 08 section 11): **S0** a document leaves the device or another person's data appears; **S1** a tool is unusable or gives a corrupt file for an ordinary valid file; **S2** important problem with a workaround; **S3** small visual or wording issue. S0 and S1 block launch; S2 is fixed unless you accept it.

## 2. Before you start

**Devices.** The minimum that satisfies the release criteria: Chrome or Edge on Windows, Chrome on an Android phone, Safari on an iPhone. Extra: Firefox on Windows, Safari on a Mac. Test on what you have and say what is missing.

**The site must be reached over HTTPS (or as `localhost`).** The tools use a browser feature that only exists on secure pages. I checked it: opening the site on a phone as `http://192.168.x.x:3100` (your PC's address on Wi-Fi) loads the page, but choosing a file does nothing and no message appears. That is not a product bug in production, where the site is HTTPS, but it makes that way of testing useless. Use one of:

1. **A staging site** (M8). Best, and the only way to test Word to PDF.
2. **An HTTPS tunnel from your PC** (works for any phone). Build and start the site, then tunnel it. On your PC, in the repository: `pnpm --filter @document-platform/web build`, then `cd apps/web` and `pnpm start --port 3100`, and in a second window `cloudflared tunnel --url http://localhost:3100`. It prints an `https://…trycloudflare.com` address; open that on the phone. (`cloudflared` is Cloudflare's free tool; I have not run it from here.)
3. **Android only, by USB cable.** Turn on USB debugging on the phone. In Chrome on the PC open `chrome://inspect/#devices`, tick "Discover USB devices", choose "Port forwarding", add `3100` → `localhost:3100`, then open `http://localhost:3100` on the phone. (A standard Chrome feature; not run from here.)

**Test files.** `document-platform-device-test-pack.zip` (about 5.5 MB, all synthetic, a `README.txt` inside explains each file). Put the zip on the phone and unzip it with the Files app. Rebuild it any time with `python3 tests/fixtures/generate_device_pack.py <empty folder>`. Also use your **own phone's camera photos** (checks A11, E4): they are the real test.

## 3. The checks

### A. Every tool, on every device

- ★ **A1.** Open the home page and the tools list. Text is readable without zooming and the page never scrolls sideways.
- ★ **A2. Merge.** Choose `01` and `02` (both in one go if the picker allows). Merge, download, open the downloaded file in the phone's PDF viewer. **Expect:** 4 pages, in the order A1, A2, B1, B2.
- ★ **A3. Organize.** Choose `03`. Move page 4 to the front. Export, download, open. **Expect:** the first page is marked P4.
- **A4. Split or Extract pages.** Choose `03`, keep only pages 2 and 3. **Expect:** a file of exactly those two pages (P2, P3).
- **A5. Rotate.** Choose `03`, turn page 1. **Expect:** the downloaded page 1 is turned, the others are not.
- **A6. PDF to JPG.** Choose `03`, make images. **Expect:** four pictures that open. Note how they arrive (separate pictures or a ZIP) and whether the phone opens them. iPhone and Android differ here.
- ★ **A7. PDF to Text.** Choose `09`. **Expect:** text appears, with a note that page 2 had no text. Tap Copy text and paste into Notes: the text is there. Download TXT: it opens.
- **A8. Remove PDF Metadata.** Choose `07`. **Expect:** the result lists what was removed (a title, an author and more) and the downloaded file opens with 3 pages.
- ★ **A9. Compress.** Choose `06` (5.4 MB). **Expect:** a result of about 80% smaller (about 5.4 MB to about 1 MB); the downloaded file opens with 5 numbered pages. Note how long it took.
- ★ **A10. Images to PDF.** Choose `14` then `13`. **Expect:** page 1 upright, with TOP at the top and the arrow pointing up (not sideways); page 2 a blue ring with a **white** middle (never black).
- ★ **A11. Your own photos.** Take three photos with the phone: one held upright, one sideways, one upside down. Make a PDF from them. **Expect:** every page upright, as you saw the picture on screen.

### B. Choosing files on a phone

- ★ **B1. Real files from real places.** Choose PDFs you already have (not private ones) that arrived by WhatsApp, by email and from Google Drive or iCloud, in Merge. **Expect:** all accepted. If one is refused with "name ends in .pdf", note the file name shown in the picker (this is the open question from ADR-035).
- **B2. No extension.** Choose `12`. **Expect:** it is refused with "Choose a file whose name ends in .pdf". That is by design; the check is for B1 above.
- **B3. iPhone photos.** If photos are stored as HEIC (the default on iPhone), choose one in Images to PDF. **Expect:** it works, or it is refused with a clear message. Note which.
- **B4. More than one at once.** In Merge, select two files in one go from the picker. **Expect:** both are added.

### C. Refusals

- ★ **C1. Password.** Choose `10` in any PDF tool. **Expect:** refused. The words should say password-protected; some browsers say "damaged or unsupported" instead. Note which.
- **C2. Damaged.** Choose `11`. **Expect:** refused as "damaged or unsupported".
- **C3. No text.** Choose `08` in PDF to Text. **Expect:** "No text layer was found" and no download offered.

### D. Proof that documents stay on the device

- ★ **D1. Airplane mode.** Do A2 (Merge) once. Then switch on airplane mode (and Wi-Fi off). Do A2 again with the same files. **Expect:** it works and you can download the result. Repeat with A9 or A7. If any tool needs the network at that step, note which. (The first run needs the network because the tool's code loads when the first file is chosen; I checked that Merge, Compress, PDF to Text and Organize all work offline on the second run.)

### E. Limits on a real phone

- ★ **E1. 200 pages.** Choose `05` in Organize. Scroll through, move one page, export. **Expect:** it works. Note anything slow, and **any time the browser tab reloads by itself** (Chrome "Aw, Snap" or Safari "a problem repeatedly occurred"): that is an S1.
- **E2. A tap on a long list.** Choose `04` in Organize and tap "Move later" ten times. **Expect:** every tap answers at once (under half a second).
- **E3. Heavy pages.** Choose `06` in PDF to JPG. **Expect:** all five pages convert and the tab does not reload. Note the time.
- ★ **E4. Many photos, and the biggest.** In Images to PDF choose 12 photos from the gallery, then make the PDF. Then try one photo at the phone's highest resolution setting if it has one (50 MP is common on Android phones). **Expect:** the tool either works or stops you with a clear message. The limits are 20 photos, 10 MB each, 32 MB together, 24 megapixels each and 160 megapixels together, so a big batch or a 50 MP photo will normally be refused: that is the designed behavior, and what I need to learn is whether those limits suit real phones. Note how many photos got through, each photo's size and megapixels, and whether the message was clear. A frozen or reloading tab is an S1.

### F. How it feels on a poor connection

- **F1.** On mobile data (or with weak signal), open the home page and then Split. **Expect:** the heading appears within a few seconds and the page does not jump when you choose a file. Note the seconds from tapping to seeing the heading.

### G. Accessibility on a real device

- ★ **G1. Largest text.** iPhone: Settings, Accessibility, Display & Text Size, Larger Text, drag to the largest. Android: Settings, Display, Font size and Display size, both largest. Open Merge, Organize and the PDF to Text result. **Expect:** nothing cut off, no sideways scrolling, every button reachable.
- ★ **G2. A screen reader.** iPhone: VoiceOver. Android: TalkBack. Do A2 (Merge) by touch and swipe. **Expect:** every control is announced with a name; after choosing files the new screen's heading is announced; the reorder buttons read "Move earlier, file 2"; the download link is read. Then do C1: the error should be spoken without hunting. **Note** whether the error is read in full more than once (ADR-036 flagged that the error area may be too wordy; your answer decides whether it is changed).
- ★ **G3. Keyboard on Windows.** Do A2 using only Tab, Shift+Tab, Enter and Space. **Expect:** every control is reached, the focus outline is always visible, and you are never stuck.
- **G4. High contrast on Windows.** Settings, Accessibility, Contrast themes, Aquatic. Open Merge. **Expect:** buttons and the focus outline are visible.
- **G5. Zoom on a PC.** Browser zoom 200% and 400%. **Expect:** nothing overlaps or disappears.
- **G6. NVDA** (free, Windows), if you have time: do A2.

### H. Other browsers on a PC

- **H1. Firefox:** A2, A3, A7, A9 including the downloads.
- **H2. Edge:** A2 and A9.
- **H3. Safari on a Mac** (borrow one if you can): A2, A3, A6.
- ★ **H4. Chrome on Windows:** A2 to A10 on the PC.

### I. Word to PDF

Needs the server, so it can only be tested on staging (M8). **I1:** choose `15`, convert. **Expect:** a 2-page PDF with a list, a table and the page break, header "Device test header". Mark `SKIP` until staging exists.

## 4. What happens with your results

I will record them in the M7 closing record. Every S0 or S1 is fixed before launch; each S2 is fixed or accepted by you in writing; S3s are listed for later. Results that show a limit is too high for real phones change the limit (ADR-017, 018, 025 say the limits are engineering controls, not promises), and results that show a time budget is wrong change ADR-037.
