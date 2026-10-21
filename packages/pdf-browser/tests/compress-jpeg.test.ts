import { describe, expect, it } from "vitest";
import { estimateQualityFromQuantSum, inspectJpeg } from "../src/compress-jpeg";
import { jpegBytes, quantTable } from "./helpers/compress-fixtures";

describe("JPEG header reader", () => {
  it("reads dimensions, components and precision", () => {
    const info = inspectJpeg(jpegBytes({ width: 640, height: 480 }));
    expect(info).toMatchObject({
      width: 640,
      height: 480,
      components: 3,
      precision: 8,
      progressive: false,
      orientation: 1,
    });
    expect(
      inspectJpeg(jpegBytes({ width: 10, height: 20, components: 1 }))
        ?.components,
    ).toBe(1);
    expect(
      inspectJpeg(jpegBytes({ width: 10, height: 20, components: 4 }))
        ?.components,
    ).toBe(4);
  });

  it("flags progressive files", () => {
    expect(
      inspectJpeg(jpegBytes({ width: 8, height: 8, progressive: true }))
        ?.progressive,
    ).toBe(true);
  });

  it.each([20, 40, 50, 60, 75, 85, 90, 95, 98])(
    "estimates quality %i from the quantisation table",
    (quality) => {
      const info = inspectJpeg(jpegBytes({ width: 8, height: 8, quality }));
      expect(info?.quality).toBeGreaterThanOrEqual(quality - 2);
      expect(info?.quality).toBeLessThanOrEqual(quality + 2);
    },
  );

  it("reads 16-bit quantisation tables", () => {
    const info = inspectJpeg(
      jpegBytes({ width: 8, height: 8, quality: 80, wideTables: true }),
    );
    expect(info?.quality).toBeGreaterThanOrEqual(78);
    expect(info?.quality).toBeLessThanOrEqual(82);
  });

  it("clamps the estimate to 1-100", () => {
    expect(estimateQualityFromQuantSum(64)).toBe(99);
    expect(estimateQualityFromQuantSum(1_000_000)).toBe(1);
    expect(quantTable(100).every((v) => v === 1)).toBe(true);
  });

  it.each([1, 3, 6, 8])(
    "reads EXIF orientation %i (little endian)",
    (orientation) => {
      expect(
        inspectJpeg(jpegBytes({ width: 8, height: 8, orientation }))
          ?.orientation,
      ).toBe(orientation);
    },
  );

  it("reads EXIF orientation in big-endian files", () => {
    const bytes = jpegBytes({
      width: 8,
      height: 8,
      orientation: 6,
      bigEndianExif: true,
    });
    expect(inspectJpeg(bytes)?.orientation).toBe(6);
  });

  it("treats an out-of-range orientation as normal", () => {
    expect(
      inspectJpeg(jpegBytes({ width: 8, height: 8, orientation: 9 }))
        ?.orientation,
    ).toBe(1);
  });

  it("rejects non-JPEG and truncated input", () => {
    expect(inspectJpeg(new Uint8Array())).toBeUndefined();
    expect(
      inspectJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    ).toBeUndefined();
    expect(inspectJpeg(new Uint8Array([0xff, 0xd8, 0xff]))).toBeUndefined();
    const full = jpegBytes({ width: 8, height: 8 });
    for (const cut of [4, 10, 40, 80])
      expect(() => inspectJpeg(full.subarray(0, cut))).not.toThrow();
    expect(inspectJpeg(full.subarray(0, 30))).toBeUndefined();
  });

  it("rejects a frame with zero size and impossible segment lengths", () => {
    expect(inspectJpeg(jpegBytes({ width: 0, height: 8 }))).toBeUndefined();
    const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0, 0]);
    expect(inspectJpeg(bad)).toBeUndefined();
  });

  it("does not read beyond a corrupted segment length", () => {
    const bytes = jpegBytes({ width: 8, height: 8 });
    // Claim the first DQT is far longer than the file.
    const copy = new Uint8Array(bytes);
    copy[4] = 0xff;
    copy[5] = 0xff;
    expect(inspectJpeg(copy)).toBeUndefined();
  });
});
