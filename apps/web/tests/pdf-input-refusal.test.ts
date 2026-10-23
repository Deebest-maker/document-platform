import { describe, expect, it, vi } from "vitest";
import { validatePdfCandidate } from "@document-platform/pdf-browser/validation";
import type { PreviewDocument } from "@document-platform/pdf-browser/preview";
import type { PdfToTextLimits } from "@document-platform/pdf-browser/pdf-to-text";
import { compressErrorCopy } from "../components/compress-pdf/session";
import { pageToolErrors } from "../components/page-tools/copy";
import {
  PdfTextSession,
  pdfTextErrorCopy,
} from "../components/pdf-to-text/session";
import { removeMetadataErrorCopy } from "../components/remove-pdf-metadata/session";
import { pdfInputCopy } from "../lib/pdf-input-copy";

// M7D (ADR-035): ten PDF tools, one first look at a chosen file. These tests pin
// the rule itself and that every tool's wording comes from the one place.

const LIMIT = { maxFileBytes: 1000 };
const candidate = (name: string, type: string, size: number) => ({
  name,
  type,
  size,
});

describe("validatePdfCandidate", () => {
  it.each([
    ["a normal PDF", candidate("a.pdf", "application/pdf", 10), undefined],
    [
      "an upper-case extension",
      candidate("A.PDF", "application/pdf", 10),
      undefined,
    ],
    ["a browser that reports no type", candidate("a.pdf", "", 10), undefined],
    [
      "a generic binary type",
      candidate("a.pdf", "application/octet-stream", 10),
      undefined,
    ],
    [
      "exactly at the limit",
      candidate("a.pdf", "application/pdf", 1000),
      undefined,
    ],
    [
      "one byte over the limit",
      candidate("a.pdf", "application/pdf", 1001),
      "INPUT_LIMIT",
    ],
    ["an empty file", candidate("a.pdf", "application/pdf", 0), "EMPTY_INPUT"],
    [
      "a text file name",
      candidate("a.txt", "application/pdf", 10),
      "UNSUPPORTED_TYPE",
    ],
    [
      "no extension",
      candidate("report", "application/pdf", 10),
      "UNSUPPORTED_TYPE",
    ],
    [
      "a trailing dot and more",
      candidate("a.pdf.exe", "application/pdf", 10),
      "UNSUPPORTED_TYPE",
    ],
    [
      "a path-like name",
      candidate("../etc/passwd", "", 10),
      "UNSUPPORTED_TYPE",
    ],
    [
      "a pdf name with an image type",
      candidate("a.pdf", "image/png", 10),
      "UNSUPPORTED_TYPE",
    ],
    [
      "a pdf name with an html type",
      candidate("a.pdf", "text/html", 10),
      "UNSUPPORTED_TYPE",
    ],
  ])("%s", (_label, file, expected) => {
    expect(validatePdfCandidate(file, LIMIT)).toBe(expected);
  });

  it("names the emptiness before the name, and the name before the size", () => {
    expect(validatePdfCandidate(candidate("a.txt", "", 0), LIMIT)).toBe(
      "EMPTY_INPUT",
    );
    expect(validatePdfCandidate(candidate("a.txt", "", 5000), LIMIT)).toBe(
      "UNSUPPORTED_TYPE",
    );
  });
});

describe("one wording for the two new refusals", () => {
  it("is shared by every tool that shows it", () => {
    for (const copy of [
      pageToolErrors,
      pdfTextErrorCopy,
      removeMetadataErrorCopy,
      compressErrorCopy,
    ]) {
      expect(copy.EMPTY_INPUT).toBe(pdfInputCopy.EMPTY_INPUT);
      expect(copy.UNSUPPORTED_TYPE).toBe(pdfInputCopy.UNSUPPORTED_TYPE);
    }
  });

  it("says what is wrong, and never blames the size limit", () => {
    expect(pdfInputCopy.EMPTY_INPUT).toMatch(/empty/i);
    expect(pdfInputCopy.UNSUPPORTED_TYPE).toMatch(/not a supported PDF/i);
    expect(pdfInputCopy.UNSUPPORTED_TYPE).toMatch(/\.pdf/);
    for (const text of Object.values(pdfInputCopy))
      expect(text).not.toMatch(/limit|too large|exceeds/i);
  });
});

describe("PDF to text refuses a file for its own reason before opening it", () => {
  const limits: PdfToTextLimits = {
    maxCharacters: 1_000_000,
    maxBytes: 4 * 1024 * 1024,
    maxPreviewCharacters: 32,
  };
  function make() {
    const openPreview = vi.fn<() => Promise<PreviewDocument>>();
    const session = new PdfTextSession(limits, undefined, {
      id: () => "session",
      openPreview,
      extractText: vi.fn(),
      writeClipboard: vi.fn(),
      createUrl: () => "blob:x",
      revokeUrl: () => undefined,
    } as never);
    return { session, openPreview };
  }

  it.each([
    ["empty.pdf", [], "application/pdf", "EMPTY_INPUT"],
    ["notes.txt", ["%PDF-"], "text/plain", "UNSUPPORTED_TYPE"],
    ["a.pdf", ["%PDF-"], "image/png", "UNSUPPORTED_TYPE"],
  ] as const)("%s", async (name, parts, type, code) => {
    const { session, openPreview } = make();
    await session.setSource(new File([...parts], name, { type }));
    expect(session.getSnapshot()).toMatchObject({
      state: "error",
      error: code,
      announcement: pdfTextErrorCopy[code],
    });
    expect(openPreview).not.toHaveBeenCalled();
  });
});
