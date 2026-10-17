import { describe, expect, it, vi } from "vitest";
import { createPagePlan } from "../src/page-model";
import { PageError } from "../src/page-errors";
import {
  extractPdfText,
  isMeaningfulText,
  normalizeLineEndings,
  PAGE_SEPARATOR,
  type PdfToTextLimits,
} from "../src/pdf-to-text";
import type { PreviewDocument } from "../src/preview/types";

const limits: PdfToTextLimits = {
  maxCharacters: 2_000_000,
  maxBytes: 8 * 1024 * 1024,
  maxPreviewCharacters: 100_000,
};

function preview(
  pages: readonly (string | (() => Promise<string>))[],
  overrides: Partial<PreviewDocument> = {},
): PreviewDocument {
  return {
    sessionId: "session",
    pageCount: pages.length,
    geometry: vi.fn(async (sourcePageNumber: number) => ({
      sourcePageNumber,
      crop: [0, 0, 612, 792],
      width: 612,
      height: 792,
      originalRotation: 0,
    })),
    render: vi.fn(async () => undefined),
    extractText: vi.fn(async (sourcePageNumber: number) => {
      const entry = pages[sourcePageNumber - 1];
      const text = typeof entry === "function" ? await entry() : (entry ?? "");
      return { text };
    }),
    destroy: vi.fn(async () => undefined),
    ...overrides,
  };
}

const planFor = (pageCount: number, sessionId = "session") =>
  createPagePlan(pageCount, sessionId);

describe("normalizeLineEndings", () => {
  it("normalizes CRLF and lone CR to \\n", () => {
    expect(normalizeLineEndings("alpha\r\nbeta\rgamma\n")).toBe(
      "alpha\nbeta\ngamma\n",
    );
  });
  it("leaves pure \\n unchanged", () => {
    expect(normalizeLineEndings("alpha\nbeta\n")).toBe("alpha\nbeta\n");
  });
});

describe("isMeaningfulText", () => {
  it("rejects whitespace-only strings", () => {
    expect(isMeaningfulText("")).toBe(false);
    expect(isMeaningfulText("   ")).toBe(false);
    expect(isMeaningfulText("\n\t ")).toBe(false);
  });
  it("accepts any non-whitespace content", () => {
    expect(isMeaningfulText("hello")).toBe(true);
    expect(isMeaningfulText("  中文 ")).toBe(true);
    expect(isMeaningfulText("<script>alert(1)</script>")).toBe(true);
  });
});

describe("extractPdfText", () => {
  it("returns pages joined by one blank line", async () => {
    const doc = preview(["Hello", "World", "Third"]);
    const result = await extractPdfText(doc, planFor(3), limits);
    expect(result.kind).toBe("text");
    expect(result.text).toBe(
      `Hello${PAGE_SEPARATOR}World${PAGE_SEPARATOR}Third`,
    );
    expect(result.totalPages).toBe(3);
    expect(result.pagesWithText).toBe(3);
    expect(result.pagesWithoutText).toEqual([]);
    expect(result.characters).toBe(result.text.length);
    expect(result.bytes).toBe(new TextEncoder().encode(result.text).byteLength);
  });

  it("preserves UTF-8 Unicode content and reports exact byte count", async () => {
    const doc = preview(["Café — résumé", "中文文字 греческий"]);
    const result = await extractPdfText(doc, planFor(2), limits);
    expect(result.kind).toBe("text");
    expect(result.text).toContain("Café");
    expect(result.text).toContain("中文文字");
    expect(result.bytes).toBe(new TextEncoder().encode(result.text).byteLength);
    expect(result.bytes).toBeGreaterThan(result.characters);
  });

  it("preserves source page order through the plan", async () => {
    const doc = preview(["One", "Two", "Three", "Four"]);
    const result = await extractPdfText(doc, planFor(4), limits);
    expect(result.text).toBe(
      ["One", "Two", "Three", "Four"].join(PAGE_SEPARATOR),
    );
    expect(result.pages.map((entry) => entry.sourcePageNumber)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("normalizes CRLF line endings in page chunks", async () => {
    const doc = preview(["line one\r\nline two\rline three"]);
    const result = await extractPdfText(doc, planFor(1), limits);
    expect(result.text).toBe("line one\nline two\nline three");
  });

  it("renders malicious-looking text literally without interpretation", async () => {
    const payload = "<script>alert(1)</script> <img src=x onerror=1>";
    const doc = preview([payload]);
    const result = await extractPdfText(doc, planFor(1), limits);
    expect(result.text).toBe(payload);
  });

  it("reports a no-text result when no page contains meaningful text", async () => {
    const doc = preview(["", "   ", "\n\t"]);
    const result = await extractPdfText(doc, planFor(3), limits);
    expect(result.kind).toBe("no-text");
    expect(result.text).toBe("");
    expect(result.characters).toBe(0);
    expect(result.bytes).toBe(0);
    expect(result.pagesWithText).toBe(0);
    expect(result.pagesWithoutText).toEqual([1, 2, 3]);
    expect(result.pages.every((entry) => entry.meaningful === false)).toBe(
      true,
    );
  });

  it("preserves partial-text documents and records affected page numbers", async () => {
    const doc = preview(["", "Only this page has text", "   ", ""]);
    const result = await extractPdfText(doc, planFor(4), limits);
    expect(result.kind).toBe("text");
    expect(result.pagesWithText).toBe(1);
    expect(result.pagesWithoutText).toEqual([1, 3, 4]);
    expect(result.text).toContain("Only this page has text");
  });

  it("rejects a mismatched plan session identifier", async () => {
    const doc = preview(["anything"]);
    await expect(() =>
      extractPdfText(doc, planFor(1, "other-session"), limits),
    ).rejects.toThrow(PageError);
  });

  it("rejects limits with zero or negative values", async () => {
    const doc = preview(["anything"]);
    await expect(() =>
      extractPdfText(doc, planFor(1), { ...limits, maxCharacters: 0 }),
    ).rejects.toThrowError(new PageError("OUTPUT_LIMIT"));
  });

  it("rejects extraction that overruns the character limit", async () => {
    const doc = preview(["a".repeat(100), "b".repeat(100)]);
    await expect(() =>
      extractPdfText(doc, planFor(2), {
        ...limits,
        maxCharacters: 150,
      }),
    ).rejects.toThrowError(new PageError("OUTPUT_LIMIT"));
  });

  it("rejects extraction that overruns the byte limit", async () => {
    const doc = preview(["x".repeat(100)]);
    await expect(() =>
      extractPdfText(doc, planFor(1), {
        ...limits,
        maxBytes: 50,
      }),
    ).rejects.toThrowError(new PageError("OUTPUT_LIMIT"));
  });

  it("cancels before scheduling subsequent pages", async () => {
    const controller = new AbortController();
    const doc = preview([
      "first",
      async () => {
        controller.abort();
        return "second";
      },
      "third",
    ]);
    await expect(() =>
      extractPdfText(doc, planFor(3), limits, {
        signal: controller.signal,
      }),
    ).rejects.toThrowError(new PageError("CANCELLED"));
    expect(doc.extractText).toHaveBeenCalledTimes(2);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const doc = preview(["anything"]);
    await expect(() =>
      extractPdfText(doc, planFor(1), limits, {
        signal: controller.signal,
      }),
    ).rejects.toThrowError(new PageError("CANCELLED"));
    expect(doc.extractText).not.toHaveBeenCalled();
  });

  it("reports progress for each page and the final validation phase", async () => {
    const progress: { phase: string; current: number; total: number }[] = [];
    const doc = preview(["one", "two"]);
    await extractPdfText(doc, planFor(2), limits, {
      onProgress: (event) => progress.push({ ...event }),
    });
    expect(progress).toEqual([
      { phase: "extracting", current: 1, total: 2 },
      { phase: "extracting", current: 2, total: 2 },
      { phase: "validating", current: 2, total: 2 },
    ]);
  });

  it("wraps unexpected engine errors into OPERATION_FAILED", async () => {
    const doc = preview(["anything"], {
      extractText: vi.fn(async () => {
        throw new Error("library-specific detail");
      }),
    });
    await expect(() =>
      extractPdfText(doc, planFor(1), limits),
    ).rejects.toThrowError(new PageError("OPERATION_FAILED"));
  });

  it("rejects when the preview does not expose extractText", async () => {
    const doc = preview(["anything"], { extractText: undefined });
    await expect(() =>
      extractPdfText(doc, planFor(1), limits),
    ).rejects.toThrowError(new PageError("OPERATION_FAILED"));
  });
});
