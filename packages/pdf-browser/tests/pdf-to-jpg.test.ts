import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { createPagePlan } from "../src/page-model";
import { PageError } from "../src/page-errors";
import {
  inspectJpeg,
  pdfToJpegQuality,
  renderPdfPagesToJpeg,
  type PdfToJpegLimits,
} from "../src/pdf-to-jpg";
import type { PreviewDocument } from "../src/preview/types";

const limits: PdfToJpegLimits = {
  maxSelectedPages: 50,
  maxPixelsPerPage: 25_000_000,
  maxAggregatePixels: 220_000_000,
  maxCanvasBytes: 100_000_000,
  maxCombinedOutputBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
};

function jpeg(width: number, height: number) {
  return new Blob(
    [
      new Uint8Array([
        0xff,
        0xd8,
        0xff,
        0xc0,
        0x00,
        0x0b,
        0x08,
        (height >> 8) & 0xff,
        height & 0xff,
        (width >> 8) & 0xff,
        width & 0xff,
        0x01,
        0x01,
        0x11,
        0x00,
        0xff,
        0xd9,
      ]),
    ],
    { type: "image/jpeg" },
  );
}

function preview(overrides: Partial<PreviewDocument> = {}): PreviewDocument {
  return {
    sessionId: "session",
    pageCount: 4,
    geometry: vi.fn(async (sourcePageNumber: number) => ({
      sourcePageNumber,
      crop: [0, 0, 612, 792],
      width: sourcePageNumber === 4 ? 792 : 612,
      height: sourcePageNumber === 4 ? 612 : 792,
      originalRotation: sourcePageNumber === 4 ? 90 : 0,
    })),
    render: vi.fn(async () => undefined),
    renderJpeg: vi.fn(async (sourcePageNumber, options) => {
      const width = Math.round(
        ((sourcePageNumber === 4 ? 792 : 612) * options.dpi) / 72,
      );
      const height = Math.round(
        ((sourcePageNumber === 4 ? 612 : 792) * options.dpi) / 72,
      );
      return { blob: jpeg(width, height), width, height };
    }),
    destroy: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("PDF to JPG bounded renderer", () => {
  it("parses JPEG signatures and dimensions", async () => {
    await expect(inspectJpeg(jpeg(1275, 1650))).resolves.toEqual({
      width: 1275,
      height: 1650,
      bytes: 17,
    });
    await expect(
      inspectJpeg(
        new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }),
      ),
    ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
  });

  it("uses exact DPI geometry and returns one selected page directly", async () => {
    const document = preview();
    const plan = createPagePlan(4, "session");
    const result = await renderPdfPagesToJpeg(document, plan, limits, {
      dpi: 150,
      selectedIds: [plan.pages[1].id],
    });
    expect(result.kind).toBe("jpg");
    expect(result.pages).toEqual([
      {
        sourcePageNumber: 2,
        filename: "page-002.jpg",
        width: 1275,
        height: 1650,
        bytes: 17,
      },
    ]);
    expect(document.renderJpeg).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ dpi: 150, quality: pdfToJpegQuality }),
    );
  });

  it("preserves source order and validates a deterministic ZIP", async () => {
    const document = preview();
    const plan = createPagePlan(4, "session");
    const result = await renderPdfPagesToJpeg(document, plan, limits, {
      dpi: 96,
      selectedIds: [plan.pages[3].id, plan.pages[1].id],
    });
    expect(result.kind).toBe("zip");
    expect(result.pages.map((page) => page.filename)).toEqual([
      "page-002.jpg",
      "page-004.jpg",
    ]);
    expect([
      ...Object.keys(
        unzipSync(new Uint8Array(await result.blob.arrayBuffer())),
      ),
    ]).toEqual(["page-002.jpg", "page-004.jpg"]);
    expect(document.renderJpeg).toHaveBeenCalledTimes(2);
    expect(document.renderJpeg).toHaveBeenNthCalledWith(
      1,
      2,
      expect.any(Object),
    );
    expect(document.renderJpeg).toHaveBeenNthCalledWith(
      2,
      4,
      expect.any(Object),
    );
  });

  it("rejects empty, excessive, and high-pixel requests before publishing", async () => {
    const document = preview();
    const plan = createPagePlan(4, "session");
    await expect(
      renderPdfPagesToJpeg(document, plan, limits, {
        dpi: 150,
        selectedIds: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_PLAN" });
    await expect(
      renderPdfPagesToJpeg(
        document,
        plan,
        { ...limits, maxSelectedPages: 1 },
        {
          dpi: 150,
          selectedIds: "all",
        },
      ),
    ).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
    await expect(
      renderPdfPagesToJpeg(
        document,
        plan,
        { ...limits, maxPixelsPerPage: 10 },
        {
          dpi: 300,
          selectedIds: [plan.pages[0].id],
        },
      ),
    ).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  });

  it("fails an entire batch when any page render fails", async () => {
    const renderJpeg = vi
      .fn<NonNullable<PreviewDocument["renderJpeg"]>>()
      .mockResolvedValueOnce({
        blob: jpeg(816, 1056),
        width: 816,
        height: 1056,
      })
      .mockRejectedValueOnce(new PageError("RENDER_FAILED"));
    const document = preview({ renderJpeg });
    await expect(
      renderPdfPagesToJpeg(document, createPagePlan(4, "session"), limits, {
        dpi: 96,
        selectedIds: "all",
      }),
    ).rejects.toMatchObject({ code: "RENDER_FAILED" });
    expect(renderJpeg).toHaveBeenCalledTimes(2);
  });
});
