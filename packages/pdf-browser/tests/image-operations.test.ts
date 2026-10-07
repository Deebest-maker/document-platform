import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { createImagesPdf } from "../src/image-operations";
import type { ImageInput, ImageLimits } from "../src/image-types";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=",
    "base64",
  ),
);
const limits: ImageLimits = {
  maxFiles: 20,
  maxFileBytes: 10_000,
  maxTotalBytes: 20_000,
  maxPages: 20,
  maxOutputBytes: 100_000,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixelsPerImage: 24_000_000,
  maxAggregatePixels: 160_000_000,
  maxDecodedBytesPerImage: 96_000_000,
  maxAggregateDecodedBytes: 640_000_000,
};

function input(id: string, width: number, height: number): ImageInput {
  return {
    id,
    blob: new Blob([png], { type: "image/png" }),
    inspection: {
      mime: "image/png",
      width,
      height,
      orientation: 1,
      displayWidth: width,
      displayHeight: height,
      pixels: width * height,
      estimatedRgbaBytes: width * height * 4,
    },
  };
}

describe("Images to PDF generation", () => {
  it("creates one valid ordered page per stable input and closes each decode", async () => {
    const closes = [vi.fn(), vi.fn()];
    let index = 0;
    const result = await createImagesPdf(
      [input("A", 200, 100), input("B", 100, 200)],
      limits,
      { pageSize: "auto", fit: "contain", orientation: "auto" },
      {
        decode: async () => {
          const dimensions = index++ === 0 ? [200, 100] : [100, 200];
          return {
            width: dimensions[0],
            height: dimensions[1],
            close: closes[index - 1],
          };
        },
        normalize: async () => png,
      },
    );
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(result.pageCount).toBe(2);
    const reopened = await PDFDocument.load(await result.blob.arrayBuffer());
    expect(reopened.getPages().map((page) => page.getSize())).toEqual([
      { width: 150, height: 75 },
      { width: 75, height: 150 },
    ]);
  });

  it("releases a decoded resource and publishes no result on decode failure", async () => {
    const close = vi.fn();
    const base = input("broken", 2, 1);
    const oriented: ImageInput = {
      ...base,
      inspection: {
        ...base.inspection,
        orientation: 6,
        displayWidth: 1,
        displayHeight: 2,
      },
    };
    await expect(
      createImagesPdf(
        [oriented],
        limits,
        { pageSize: "a4", fit: "contain", orientation: "portrait" },
        {
          decode: async () => ({ width: 2, height: 1, close }),
          normalize: async () => {
            throw new Error("synthetic");
          },
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE", inputId: "broken" });
    expect(close).toHaveBeenCalledOnce();
  });
});
