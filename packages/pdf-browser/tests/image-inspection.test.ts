import { describe, expect, it } from "vitest";
import {
  inspectImageBytes,
  stripJpegExif,
  validateImageInputs,
} from "../src/image-inspection";
import { ImagePdfError, type ImageLimits } from "../src/image-types";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=",
    "base64",
  ),
);

function orientedJpeg() {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12,
    0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01,
    0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

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

describe("image header inspection", () => {
  it("recognizes PNG signature and dimensions", () => {
    expect(inspectImageBytes(png, "image/png")).toMatchObject({
      mime: "image/png",
      width: 1,
      height: 1,
      orientation: 1,
      pixels: 1,
    });
  });

  it("reads JPEG dimensions and EXIF orientation before decoding", () => {
    expect(inspectImageBytes(orientedJpeg(), "image/jpeg")).toMatchObject({
      mime: "image/jpeg",
      width: 3,
      height: 2,
      orientation: 6,
      displayWidth: 2,
      displayHeight: 3,
      pixels: 6,
    });
  });

  it("rejects signature mismatch and aggregate decoded pressure", () => {
    expect(() => inspectImageBytes(png, "image/jpeg")).toThrowError(
      expect.objectContaining({ code: "SIGNATURE_MISMATCH" }),
    );
    const inspection = inspectImageBytes(png);
    expect(() =>
      validateImageInputs(
        [
          { id: "a", blob: new Blob([png]), inspection },
          { id: "b", blob: new Blob([png]), inspection },
        ],
        { ...limits, maxAggregatePixels: 1 },
      ),
    ).toThrowError(ImagePdfError);
  });

  it.each([2, 3, 6, 8] as const)(
    "parses representative EXIF orientation %s",
    (orientation) => {
      const bytes = orientedJpeg();
      bytes[31] = orientation;
      const result = inspectImageBytes(bytes, "image/jpeg");
      expect(result.orientation).toBe(orientation);
      expect([result.displayWidth, result.displayHeight]).toEqual(
        orientation >= 5 ? [2, 3] : [3, 2],
      );
    },
  );

  it("removes the EXIF APP1 segment while retaining JPEG image data", () => {
    const source = orientedJpeg();
    const stripped = stripJpegExif(source);
    expect(stripped.length).toBeLessThan(source.length);
    expect(Array.from(stripped.slice(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xc0]);
    expect(inspectImageBytes(stripped, "image/jpeg")).toMatchObject({
      width: 3,
      height: 2,
      orientation: 1,
    });
  });

  it("rejects empty, corrupt, compressed-size, count, dimension, and pixel limits", () => {
    const inspection = inspectImageBytes(png, "image/png");
    expect(() => inspectImageBytes(Uint8Array.of(1, 2, 3))).toThrowError(
      expect.objectContaining({ code: "SIGNATURE_MISMATCH" }),
    );
    expect(() =>
      validateImageInputs(
        [{ id: "empty", blob: new Blob(), inspection }],
        limits,
      ),
    ).toThrowError(expect.objectContaining({ code: "EMPTY_INPUT" }));
    expect(() =>
      validateImageInputs(
        Array.from({ length: 21 }, (_, index) => ({
          id: String(index),
          blob: new Blob([png]),
          inspection,
        })),
        limits,
      ),
    ).toThrowError(expect.objectContaining({ code: "INPUT_COUNT" }));
    expect(() =>
      validateImageInputs(
        [{ id: "large", blob: new Blob([png]), inspection }],
        { ...limits, maxFileBytes: 1 },
      ),
    ).toThrowError(expect.objectContaining({ code: "INPUT_LIMIT" }));
    expect(() =>
      validateImageInputs([{ id: "wide", blob: new Blob([png]), inspection }], {
        ...limits,
        maxWidth: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "DIMENSION_LIMIT" }));
    expect(() =>
      validateImageInputs(
        [{ id: "pixels", blob: new Blob([png]), inspection }],
        { ...limits, maxPixelsPerImage: 0 },
      ),
    ).toThrowError(expect.objectContaining({ code: "PIXEL_LIMIT" }));
  });
});
