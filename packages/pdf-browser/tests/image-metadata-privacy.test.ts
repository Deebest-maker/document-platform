import { crc32 } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { createImagesPdf } from "../src/image-operations";
import { inspectImageBytes } from "../src/image-inspection";
import type { ImageInput, ImageLimits } from "../src/image-types";
import { baselineJpeg } from "./helpers/jpeg-samples";

/**
 * ADR-030: what Images to PDF puts into the PDF must not include the
 * metadata that photos and image files carry. These tests look at the bytes of
 * the finished PDF, which is what a recipient or a forensic tool would see.
 */

const limits: ImageLimits = {
  maxFiles: 20,
  maxFileBytes: 1_000_000,
  maxTotalBytes: 2_000_000,
  maxPages: 20,
  maxOutputBytes: 5_000_000,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixelsPerImage: 24_000_000,
  maxAggregatePixels: 160_000_000,
  maxDecodedBytesPerImage: 96_000_000,
  maxAggregateDecodedBytes: 640_000_000,
};

const text = (value: string) => new TextEncoder().encode(value);
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const u32 = (value: number) =>
  Uint8Array.of(
    value >>> 24,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  );
const segment = (marker: number, payload: Uint8Array) =>
  join(
    Uint8Array.of(0xff, marker, (payload.length + 2) >> 8, payload.length + 2),
    payload,
  );

/** A real EXIF block: big-endian TIFF, one Orientation entry (1), then extra data. */
function exifBlock(extra: string) {
  const tiff = Uint8Array.of(
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // header, IFD at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00, // Orientation = 1
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  );
  return segment(0xe1, join(text("Exif\0\0"), tiff, text(extra)));
}

const SECRET_JPEG = [
  "SecretCameraModelXYZ",
  "SecretGpsLatLong",
  "SecretXmpAuthor",
  "SecretComment",
  "SecretTrailerAfterEoi",
];

const dirtyJpeg = join(
  baselineJpeg.subarray(0, 2),
  exifBlock("SecretCameraModelXYZ SecretGpsLatLong"),
  segment(
    0xe1,
    join(
      text("http://ns.adobe.com/xap/1.0/\0"),
      text("<x:xmpmeta>SecretXmpAuthor</x:xmpmeta>"),
    ),
  ),
  segment(0xfe, text("SecretComment")),
  baselineJpeg.subarray(2),
  text("SecretTrailerAfterEoi"),
);

function chunk(type: string, data: Uint8Array) {
  const body = join(text(type), data);
  return join(u32(data.length), body, u32(crc32(body)));
}

const tinyPng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=",
    "base64",
  ),
);
// Insert text, international text and EXIF chunks right after IHDR (8 + 25 bytes).
const dirtyPng = join(
  tinyPng.subarray(0, 33),
  chunk("tEXt", text("Author\0SecretPngAuthor")),
  chunk("iTXt", text("Comment\0\0\0\0\0SecretPngComment")),
  chunk("eXIf", text("MM\0*SecretPngExif")),
  tinyPng.subarray(33),
);

function jpegInput(id: string, bytes: Uint8Array): ImageInput {
  return {
    id,
    blob: new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
    inspection: inspectImageBytes(bytes, "image/jpeg"),
  };
}

function pngInput(id: string, bytes: Uint8Array): ImageInput {
  return {
    id,
    blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    inspection: inspectImageBytes(bytes, "image/png"),
  };
}

async function generate(inputs: ImageInput[], close = vi.fn()) {
  const result = await createImagesPdf(
    inputs,
    limits,
    { pageSize: "auto", fit: "contain", orientation: "auto" },
    {
      decode: async (blob) => {
        const inspected = inspectImageBytes(
          new Uint8Array(await blob.arrayBuffer()),
        );
        return { width: inspected.width, height: inspected.height, close };
      },
      normalize: async () => {
        throw new Error("rotation is not expected here");
      },
    },
  );
  return Buffer.from(await result.blob.arrayBuffer());
}

describe("Images to PDF keeps image metadata out of the PDF (ADR-030)", () => {
  it("test data really does contain the secrets, and a plain embed would leak them", async () => {
    for (const secret of SECRET_JPEG)
      expect(Buffer.from(dirtyJpeg).includes(secret)).toBe(true);
    const doc = await PDFDocument.create();
    await doc.embedJpg(dirtyJpeg);
    const naive = Buffer.from(await doc.save({ useObjectStreams: false }));
    expect(naive.includes("SecretCameraModelXYZ")).toBe(true);
  });

  it("drops EXIF, GPS, XMP, comments and trailing data from a JPEG", async () => {
    const pdf = await generate([jpegInput("photo", dirtyJpeg)]);
    for (const secret of SECRET_JPEG)
      expect(pdf.includes(secret), secret).toBe(false);
  });

  it("keeps the picture itself: the clean JPEG bytes are in the PDF unchanged", async () => {
    const pdf = await generate([jpegInput("photo", dirtyJpeg)]);
    expect(pdf.includes(Buffer.from(baselineJpeg))).toBe(true);
    const reopened = await PDFDocument.load(pdf);
    expect(reopened.getPageCount()).toBe(1);
  });

  it("drops PNG text and EXIF chunks", async () => {
    for (const secret of [
      "SecretPngAuthor",
      "SecretPngComment",
      "SecretPngExif",
    ])
      expect(Buffer.from(dirtyPng).includes(secret), secret).toBe(true);
    const pdf = await generate([pngInput("png", dirtyPng)]);
    for (const secret of [
      "SecretPngAuthor",
      "SecretPngComment",
      "SecretPngExif",
    ])
      expect(pdf.includes(secret), secret).toBe(false);
  });

  it("handles a mixed batch", async () => {
    const pdf = await generate([
      jpegInput("a", dirtyJpeg),
      pngInput("b", dirtyPng),
      jpegInput("c", dirtyJpeg),
    ]);
    expect(pdf.includes("Secret")).toBe(false);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);
  });

  it("redraws a JPEG whose layout the stripper does not understand, instead of embedding it", async () => {
    // The browser could decode this file, but it has no scan the stripper can
    // follow. Embedding it unchanged could carry metadata, so it is redrawn.
    const odd = join(dirtyJpeg.subarray(0, 60), text("SecretOddFileMarker"));
    const input: ImageInput = {
      id: "odd",
      blob: new Blob([odd], { type: "image/jpeg" }),
      inspection: inspectImageBytes(baselineJpeg, "image/jpeg"),
    };
    const close = vi.fn();
    const normalize = vi.fn(async () => new Uint8Array(baselineJpeg));
    const result = await createImagesPdf(
      [input],
      limits,
      { pageSize: "auto", fit: "contain", orientation: "auto" },
      {
        decode: async () => ({ width: 24, height: 24, close }),
        normalize,
      },
    );
    const pdf = Buffer.from(await result.blob.arrayBuffer());
    expect(normalize).toHaveBeenCalledOnce();
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 24, height: 24 }),
      1,
      "image/jpeg",
    );
    expect(pdf.includes("SecretOddFileMarker")).toBe(false);
    expect(pdf.includes("Secret")).toBe(false);
    expect(pdf.includes(Buffer.from(baselineJpeg))).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not redraw JPEGs it can clean, so their pixels are never re-saved", async () => {
    const normalize = vi.fn();
    await createImagesPdf(
      [jpegInput("photo", dirtyJpeg)],
      limits,
      { pageSize: "auto", fit: "contain", orientation: "auto" },
      {
        decode: async () => ({ width: 24, height: 24, close: vi.fn() }),
        normalize,
      },
    );
    expect(normalize).not.toHaveBeenCalled();
  });
});
