import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import { unzlibSync, zlibSync } from "fflate";
import { compressPdf } from "../src/compress-pdf";
import {
  DEFAULT_COMPRESS_LIMITS,
  type CompressLimits,
  type CompressResult,
} from "../src/compress-types";
import { PageError } from "../src/page-errors";
import { adler32 } from "../src/compress-inflate";
import {
  fakeCodec,
  noiseSamples,
  pdfWithImages,
  type ImageSpec,
} from "./helpers/compress-fixtures";
import { fixtureBytes } from "./helpers/pdf-assertions";

const input = (bytes: Uint8Array) => ({
  id: "compress-test",
  blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
});
const limits = (over: Partial<CompressLimits> = {}): CompressLimits => ({
  ...DEFAULT_COMPRESS_LIMITS,
  ...over,
});
const bytesOf = async (result: CompressResult) =>
  new Uint8Array(await result.blob!.arrayBuffer());

// A large photo (432 dpi) and a raster at 216 dpi, both above the balanced target.
const bigJpeg = (over: Partial<ImageSpec> = {}): ImageSpec => ({
  width: 3000,
  height: 2000,
  kind: "jpeg",
  drawWidth: 500,
  drawHeight: 333,
  size: 600_000,
  quality: 92,
  ...over,
});
const bigRaster = (over: Partial<ImageSpec> = {}): ImageSpec => ({
  width: 900,
  height: 600,
  kind: "flate",
  drawWidth: 300,
  drawHeight: 200,
  ...over,
});

const name = (doc: PDFDocument, ref: PDFRef, key: string) =>
  (doc.context.lookup(ref) as PDFRawStream).dict.get(PDFName.of(key));
const num = (value: unknown) => (value as PDFNumber).asNumber();

describe("image optimisation", () => {
  it("downsamples and re-encodes oversized photos and rasters", async () => {
    const { bytes, refs } = await pdfWithImages([bigJpeg(), bigRaster()], {
      onePagePerImage: true,
    });
    const codec = fakeCodec();
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec },
    );
    expect(result.outcome).toBe("reduced");
    expect(result.images).toMatchObject({ found: 2, optimized: 2 });
    expect(result.images.bytesAfter).toBeLessThan(
      result.images.bytesBefore / 10,
    );
    expect(result.outputBytes).toBeLessThan(result.inputBytes / 5);
    // 432 dpi -> 150 dpi and 216 dpi -> 150 dpi
    expect(
      codec.calls
        .map((c) => [c.source, c.width, c.height, c.quality])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["jpeg", 1042, 694, 75],
      ["rgba", 625, 417, 75],
    ]);
    const doc = await PDFDocument.load(await bytesOf(result));
    const [jpeg, raster] = [refs[0], refs[1]];
    expect(name(doc, jpeg, "Filter")).toBe(PDFName.of("DCTDecode"));
    expect([
      num(name(doc, jpeg, "Width")),
      num(name(doc, jpeg, "Height")),
    ]).toEqual([1042, 694]);
    expect(name(doc, raster, "Filter")).toBe(PDFName.of("DCTDecode"));
    expect([
      num(name(doc, raster, "Width")),
      num(name(doc, raster, "Height")),
    ]).toEqual([625, 417]);
    expect(num(name(doc, raster, "BitsPerComponent"))).toBe(8);
    expect(name(doc, raster, "ColorSpace")).toBe(PDFName.of("DeviceRGB"));
  });

  it("applies each profile's resolution and quality", async () => {
    const { bytes } = await pdfWithImages([bigJpeg()]);
    const seen: Record<string, [number, number, number]> = {};
    for (const profile of ["light", "balanced", "strong"] as const) {
      const codec = fakeCodec();
      await compressPdf(input(bytes), profile, limits(), {}, { codec });
      seen[profile] = [
        codec.calls[0].width,
        codec.calls[0].height,
        codec.calls[0].quality,
      ];
    }
    expect(seen).toEqual({
      light: [1528, 1019, 85],
      balanced: [1042, 694, 75],
      strong: [764, 509, 60],
    });
  });

  it("keeps the other image dictionary entries", async () => {
    const { bytes, refs } = await pdfWithImages([
      bigJpeg({
        configure: (dict) => {
          dict.set(PDFName.of("OC"), PDFName.of("Layer1"));
          dict.set(PDFName.of("StructParent"), PDFNumber.of(3));
          dict.set(PDFName.of("Interpolate"), PDFBool.True);
          dict.set(PDFName.of("Intent"), PDFName.of("Perceptual"));
        },
      }),
    ]);
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: fakeCodec() },
    );
    const doc = await PDFDocument.load(await bytesOf(result));
    expect(name(doc, refs[0], "OC")).toBe(PDFName.of("Layer1"));
    expect(num(name(doc, refs[0], "StructParent"))).toBe(3);
    expect(name(doc, refs[0], "Interpolate")).toBe(PDFBool.True);
    expect(name(doc, refs[0], "Intent")).toBe(PDFName.of("Perceptual"));
  });

  it("re-encodes grey images as RGB and keeps ICC colour spaces", async () => {
    const { bytes, refs } = await pdfWithImages(
      [
        bigJpeg({ color: "gray" }),
        bigJpeg({
          configure: (dict, doc) => {
            const profile = doc.context.register(
              doc.context.stream(new Uint8Array(128), { N: 3 } as never),
            );
            dict.set(
              PDFName.of("ColorSpace"),
              doc.context.obj([PDFName.of("ICCBased"), profile]),
            );
          },
        }),
      ],
      { onePagePerImage: true },
    );
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: fakeCodec() },
    );
    expect(result.images.optimized).toBe(2);
    const doc = await PDFDocument.load(await bytesOf(result));
    expect(name(doc, refs[0], "ColorSpace")).toBe(PDFName.of("DeviceRGB"));
    expect(name(doc, refs[1], "ColorSpace")).toBeInstanceOf(PDFArray);
  });

  it("recodes an at-target JPEG only when its quality is clearly higher", async () => {
    // 150 dpi photo: 1042 x 695 px at 500 x 333 pt.
    const spec = (quality: number): ImageSpec => ({
      width: 1042,
      height: 695,
      kind: "jpeg",
      drawWidth: 500,
      drawHeight: 333,
      quality,
      size: 400_000,
    });
    const high = fakeCodec();
    const lower = fakeCodec();
    await compressPdf(
      input((await pdfWithImages([spec(95)])).bytes),
      "balanced",
      limits(),
      {},
      { codec: high },
    );
    const result = await compressPdf(
      input((await pdfWithImages([spec(70)])).bytes),
      "balanced",
      limits(),
      {},
      { codec: lower },
    );
    expect(high.calls).toHaveLength(1);
    expect([high.calls[0].width, high.calls[0].height]).toEqual([1042, 695]);
    expect(lower.calls).toHaveLength(0);
    expect(result.images.skipped).toEqual({ at_target: 1 });
  });

  const skipCases: [string, ImageSpec[], string][] = [
    [
      "a stencil mask",
      [
        bigJpeg({
          configure: (d) => d.set(PDFName.of("ImageMask"), PDFBool.True),
        }),
      ],
      "image_mask",
    ],
    [
      "an image with a soft mask",
      [
        bigJpeg({
          configure: (d) => d.set(PDFName.of("SMask"), PDFName.of("x")),
        }),
      ],
      "has_mask",
    ],
    [
      "a colour-key mask",
      [
        bigJpeg({
          configure: (d) => d.set(PDFName.of("Mask"), PDFName.of("x")),
        }),
      ],
      "has_mask",
    ],
    [
      "a Decode array",
      [
        bigJpeg({
          configure: (d, doc) =>
            d.set(PDFName.of("Decode"), doc.context.obj([1, 0, 1, 0, 1, 0])),
        }),
      ],
      "decode_array",
    ],
    [
      "a non-8-bit image",
      [
        bigJpeg({
          configure: (d) =>
            d.set(PDFName.of("BitsPerComponent"), PDFNumber.of(4)),
        }),
      ],
      "bit_depth",
    ],
    [
      "a CMYK colour space",
      [
        bigJpeg({
          configure: (d) =>
            d.set(PDFName.of("ColorSpace"), PDFName.of("DeviceCMYK")),
        }),
      ],
      "color_space",
    ],
    ["an EXIF-rotated JPEG", [bigJpeg({ orientation: 6 })], "orientation"],
    [
      "an unknown filter",
      [
        bigJpeg({
          configure: (d) =>
            d.set(PDFName.of("Filter"), PDFName.of("JPXDecode")),
        }),
      ],
      "filter",
    ],
    [
      "a flat graphic",
      [bigRaster({ flat: true, width: 1200, height: 800 })],
      "flat_graphic",
    ],
    [
      "a JPEG whose header disagrees with the dictionary",
      [
        bigJpeg({
          configure: (d) => d.set(PDFName.of("Width"), PDFNumber.of(2999)),
        }),
      ],
      "jpeg_mismatch",
    ],
    [
      "an oversized JPEG",
      [bigJpeg({ width: 9000, height: 8000, drawWidth: 900, drawHeight: 800 })],
      "too_large",
    ],
  ];
  it.each(skipCases)("leaves %s unchanged", async (_label, specs, reason) => {
    const { bytes, refs } = await pdfWithImages(specs);
    const codec = fakeCodec();
    const before = await PDFDocument.load(bytes);
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits({ maxJpegPixels: 20_000_000 }),
      {},
      { codec },
    );
    expect(codec.calls).toHaveLength(0);
    expect(result.images).toMatchObject({ found: 1, optimized: 0 });
    expect(result.images.skipped).toEqual({ [reason]: 1 });
    if (result.blob) {
      const doc = await PDFDocument.load(await bytesOf(result));
      const a = (before.context.lookup(refs[0]) as PDFRawStream).contents;
      const b = (doc.context.lookup(refs[0]) as PDFRawStream).contents;
      if (reason !== "flat_graphic") expect(b).toEqual(a);
    }
  });

  it("leaves an image alone when it is also used outside the pages", async () => {
    const { bytes, doc, refs } = await pdfWithImages([bigJpeg()]);
    const second = doc.getPages()[0];
    const form = doc.context.stream("q 400 0 0 200 0 0 cm /I Do Q", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 400, 200],
      Resources: { XObject: { I: refs[0] } },
    } as never);
    second.node.set(
      PDFName.of("Annots"),
      doc.context.obj([
        doc.context.register(
          doc.context.obj({
            Type: "Annot",
            Subtype: "Stamp",
            Rect: [0, 0, 400, 200],
            AP: { N: doc.context.register(form) },
          }),
        ),
      ]),
    );
    const edited = await doc.save();
    expect(bytes.length).toBeGreaterThan(0);
    const codec = fakeCodec();
    const result = await compressPdf(
      input(edited),
      "balanced",
      limits(),
      {},
      { codec },
    );
    expect(codec.calls).toHaveLength(0);
    expect(result.images.skipped).toEqual({ shared_use: 1 });
  });

  it("rejects codec output that does not have the requested size", async () => {
    const { bytes } = await pdfWithImages([bigJpeg()]);
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: fakeCodec({ wrongSize: true }) },
    );
    expect(result.images.skipped).toEqual({ decode_failed: 1 });
  });

  it("keeps an image when the codec fails", async () => {
    const { bytes } = await pdfWithImages([bigJpeg()]);
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: fakeCodec({ fail: true }) },
    );
    expect(result.images).toMatchObject({
      optimized: 0,
      skipped: { decode_failed: 1 },
    });
  });

  it("keeps an image when re-encoding does not save at least 10%", async () => {
    const { bytes } = await pdfWithImages([bigJpeg({ size: 50_000 })]);
    // 1042 x 695 x 0.2 bytes = 144 kB, bigger than the 50 kB original.
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: fakeCodec({ ratio: 0.2 }) },
    );
    expect(result.images.skipped).toEqual({ not_smaller: 1 });
  });

  it("falls back to lossless-only when the browser has no image codec", async () => {
    const { bytes } = await pdfWithImages([bigJpeg(), bigRaster()], {
      onePagePerImage: true,
    });
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: null },
    );
    expect(result.warnings).toContain("images_unavailable");
    expect(result.images).toMatchObject({
      found: 2,
      optimized: 0,
      skipped: { codec_unavailable: 2 },
    });
  });

  it("limits the number of images, largest first", async () => {
    const { bytes } = await pdfWithImages(
      [
        bigJpeg({ size: 100_000 }),
        bigJpeg({ size: 500_000 }),
        bigJpeg({ size: 300_000 }),
      ],
      { onePagePerImage: true },
    );
    const codec = fakeCodec();
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits({ maxImages: 1 }),
      {},
      { codec },
    );
    expect(result.images).toMatchObject({
      found: 3,
      optimized: 1,
      skipped: { limit_images: 2 },
    });
    expect(result.images.bytesBefore).toBe(500_000);
  });

  it("stops optimising when the time budget is spent", async () => {
    const { bytes } = await pdfWithImages([bigJpeg(), bigJpeg(), bigJpeg()], {
      onePagePerImage: true,
    });
    let clock = 0;
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits({ imageBudgetMs: 2500 }),
      {},
      { codec: fakeCodec(), now: () => (clock += 1000) },
    );
    expect(result.images.optimized).toBeGreaterThanOrEqual(1);
    expect(result.images.optimized).toBeLessThan(3);
    expect(result.images.skipped.time_budget).toBe(3 - result.images.optimized);
  });

  it("leaves every image unchanged when placement cannot be trusted", async () => {
    const { doc } = await pdfWithImages([bigJpeg()]);
    doc.getPages()[0].node.set(PDFName.of("UserUnit"), PDFNumber.of(4));
    const codec = fakeCodec();
    const result = await compressPdf(
      input(await doc.save()),
      "balanced",
      limits(),
      {},
      { codec },
    );
    expect(codec.calls).toHaveLength(0);
    expect(result.images.skipped).toEqual({ layout_unknown: 1 });
    expect(result.warnings).toContain("layout_unknown");
  });
});

describe("lossless structure pass", () => {
  async function pdfWithStream(
    contents: Uint8Array,
    entries: Record<string, unknown> = {},
    extra: (doc: PDFDocument) => void = () => {},
  ) {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const stream = doc.context.stream(contents, entries as never);
    const ref = doc.context.register(stream);
    doc.catalog.set(PDFName.of("TestData"), ref);
    extra(doc);
    return { bytes: await doc.save({ useObjectStreams: false }), ref };
  }
  const repetitive = (length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = 97 + ((i * 7) % 13);
    return out;
  };
  const decodedOf = async (result: CompressResult, ref: PDFRef) => {
    const doc = await PDFDocument.load(await bytesOf(result));
    const stream = doc.context.lookup(ref) as PDFRawStream;
    return { stream, filter: stream.dict.get(PDFName.of("Filter")) };
  };

  it("compresses streams that have no filter", async () => {
    const data = repetitive(80_000);
    const { bytes, ref } = await pdfWithStream(data);
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: null },
    );
    expect(result.outcome).toBe("reduced");
    expect(result.streamsRecompressed).toBeGreaterThanOrEqual(1);
    const { stream, filter } = await decodedOf(result, ref);
    expect(filter).toBe(PDFName.of("FlateDecode"));
    expect(unzlibSync(stream.contents)).toEqual(data);
  });

  it("re-deflates fast-compressed streams without changing content", async () => {
    const data = repetitive(200_000);
    const fast = zlibSync(data, { level: 1 });
    const { bytes, ref } = await pdfWithStream(fast, { Filter: "FlateDecode" });
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: null },
    );
    const { stream } = await decodedOf(result, ref);
    expect(stream.contents.length).toBeLessThanOrEqual(fast.length);
    expect(unzlibSync(stream.contents)).toEqual(data);
  });

  it("keeps predictor parameters while re-deflating predicted data", async () => {
    const rows = 40;
    const columns = 50;
    const predicted = new Uint8Array((columns * 3 + 1) * rows);
    predicted.set(repetitive(predicted.length));
    const { bytes, ref } = await pdfWithStream(
      zlibSync(predicted, { level: 1 }),
      {
        Filter: "FlateDecode",
        DecodeParms: { Predictor: 15, Columns: columns, Colors: 3 },
      },
    );
    const result = await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: null },
    );
    const { stream } = await decodedOf(result, ref);
    const parms = stream.dict.get(PDFName.of("DecodeParms")) as PDFDict;
    expect(num(parms.get(PDFName.of("Predictor")))).toBe(15);
    expect(unzlibSync(stream.contents)).toEqual(predicted);
  });

  it("does not touch XMP metadata streams", async () => {
    const xmp = repetitive(5000);
    const doc = await PDFDocument.create();
    doc.addPage();
    const metadata = doc.context.register(
      doc.context.stream(xmp, { Type: "Metadata", Subtype: "XML" } as never),
    );
    doc.catalog.set(PDFName.of("Metadata"), metadata);
    let candidate: Uint8Array = new Uint8Array();
    const result = await compressPdf(
      input(await doc.save({ useObjectStreams: false })),
      "balanced",
      limits(),
      {},
      { codec: null, onCandidate: (b) => (candidate = b) },
    );
    expect(result.streamsRecompressed).toBe(0);
    const out = await PDFDocument.load(candidate);
    const stream = out.context.lookup(metadata) as PDFRawStream;
    expect(stream.dict.has(PDFName.of("Filter"))).toBe(false);
    expect(stream.contents).toEqual(xmp);
  });

  it("repairs Flate streams whose checksum bytes pdf-lib trimmed on load", async () => {
    // pdf-lib 1.17 strips a trailing LF/CR from streams whose /Length is an
    // indirect reference and whose data runs straight into "endstream" (it
    // takes the byte for the end-of-line marker). A Flate stream ending in
    // 0x0A then loses its last checksum byte.
    let content = new Uint8Array();
    let packed = new Uint8Array();
    for (let seed = 0; seed < 5000; seed++) {
      content = new TextEncoder().encode(
        `q 1 0 0 1 0 0 cm Q % ${"x".repeat(seed % 251)}${seed}\n`,
      );
      packed = zlibSync(content, { level: 6 });
      if (packed[packed.length - 1] === 0x0a) break;
    }
    expect(packed[packed.length - 1]).toBe(0x0a);
    const head = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n" +
        "4 0 obj\n<< /Length 5 0 R /Filter /FlateDecode >>\nstream\n",
    );
    const tail = new TextEncoder().encode(
      `endstream\nendobj\n5 0 obj\n${packed.length}\nendobj\ntrailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n`,
    );
    const file = new Uint8Array(head.length + packed.length + tail.length);
    file.set(head);
    file.set(packed, head.length);
    file.set(tail, head.length + packed.length);

    // Characterisation of the library behaviour the repair works around.
    const plain = await PDFDocument.load(file);
    const loaded = plain.context.lookup(PDFRef.of(4, 0)) as PDFRawStream;
    expect(loaded.contents.length).toBeLessThan(packed.length);
    expect(() => unzlibSync(loaded.contents)).toThrow();

    let candidate: Uint8Array = new Uint8Array();
    const result = await compressPdf(
      input(file),
      "balanced",
      limits(),
      {},
      { codec: null, onCandidate: (b) => (candidate = b) },
    );
    expect(result.streamsRepaired).toBe(1);
    const out = await PDFDocument.load(candidate);
    const fixed = out.context.lookup(PDFRef.of(4, 0)) as PDFRawStream;
    // A strict zlib reader accepts it, checksum included.
    expect(unzlibSync(fixed.contents)).toEqual(content);
    expect(adler32([content])).toBe(
      new DataView(fixed.contents.buffer, fixed.contents.byteOffset).getUint32(
        fixed.contents.length - 4,
      ),
    );
  });

  it("leaves a stream with a corrupt checksum alone", async () => {
    const data = repetitive(50_000);
    const bad = zlibSync(data, { level: 1 });
    bad[bad.length - 1] ^= 0x55;
    bad[bad.length - 2] ^= 0x55;
    const { bytes, ref } = await pdfWithStream(bad, { Filter: "FlateDecode" });
    let candidate: Uint8Array = new Uint8Array();
    await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {},
      { codec: null, onCandidate: (b) => (candidate = b) },
    );
    const out = await PDFDocument.load(candidate);
    expect((out.context.lookup(ref) as PDFRawStream).contents).toEqual(bad);
  });

  it("does not expand decompression bombs", { timeout: 30_000 }, async () => {
    // 40 MiB of zeros packs to a few dozen KiB and is five times the 8 MiB
    // per-stream cap below. (A 300 MiB bomb took 3.5 s just to build and
    // timed out the default 5 s test limit on a slower CI runner.)
    const bomb = zlibSync(new Uint8Array(40 * 1024 * 1024), { level: 1 });
    expect(bomb.length).toBeLessThan(2_000_000);
    const { bytes, ref } = await pdfWithStream(bomb, { Filter: "FlateDecode" });
    let candidate: Uint8Array = new Uint8Array();
    const started = Date.now();
    await compressPdf(
      input(bytes),
      "balanced",
      limits({ maxStreamInflateBytes: 8 * 1024 * 1024 }),
      {},
      { codec: null, onCandidate: (b) => (candidate = b) },
    );
    expect(Date.now() - started).toBeLessThan(5000);
    const out = await PDFDocument.load(candidate);
    expect((out.context.lookup(ref) as PDFRawStream).contents).toEqual(bomb);
  });

  it("stops inflating once the total budget is spent", async () => {
    const make = (seed: number) =>
      zlibSync(
        noiseSamples(300_000, seed).map((v) => v % 4),
        { level: 1 },
      );
    const doc = await PDFDocument.create();
    doc.addPage();
    const refs = [1, 2, 3].map((seed) => {
      const ref = doc.context.register(
        doc.context.stream(make(seed), { Filter: "FlateDecode" } as never),
      );
      doc.catalog.set(PDFName.of(`Data${seed}`), ref);
      return ref;
    });
    let candidate: Uint8Array = new Uint8Array();
    const result = await compressPdf(
      input(await doc.save({ useObjectStreams: false })),
      "balanced",
      limits({ maxTotalInflateBytes: 650_000 }),
      {},
      { codec: null, onCandidate: (b) => (candidate = b) },
    );
    expect(result.streamsRecompressed).toBe(2);
    const out = await PDFDocument.load(candidate);
    const lengths = refs.map(
      (ref) => (out.context.lookup(ref) as PDFRawStream).contents.length,
    );
    expect(lengths[0]).toBeLessThan(make(1).length);
    expect(lengths[1]).toBeLessThan(make(2).length);
    expect(lengths[2]).toBe(make(3).length);
  });
});

describe("input handling and result contract", () => {
  const run = (bytes: Uint8Array, over: Partial<CompressLimits> = {}) =>
    compressPdf(
      input(bytes),
      "balanced",
      limits(over),
      {},
      { codec: fakeCodec() },
    );
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(PageError);
      return (error as PageError).code;
    }
    return "no-error";
  };

  it("refuses password-protected files", async () => {
    expect(await failure(run(fixtureBytes("encrypted.pdf")))).toBe(
      "ENCRYPTED_PDF",
    );
  });

  it("refuses corrupt and non-PDF input", async () => {
    expect(await failure(run(fixtureBytes("corrupt.pdf")))).toBe("INVALID_PDF");
    expect(
      await failure(run(new TextEncoder().encode("hello, not a pdf"))),
    ).toBe("INVALID_PDF");
    expect(
      await failure(
        run(new TextEncoder().encode("%PDF-1.4\nthis is garbage\n")),
      ),
    ).toBe("INVALID_PDF");
  });

  it("enforces the size and page limits", async () => {
    const { bytes } = await pdfWithImages([bigJpeg()]);
    expect(await failure(run(bytes, { maxInputBytes: 1000 }))).toBe(
      "INPUT_LIMIT",
    );
    expect(await failure(run(new Uint8Array()))).toBe("INPUT_LIMIT");
    const doc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) doc.addPage();
    expect(await failure(run(await doc.save(), { maxPages: 4 }))).toBe(
      "PAGE_LIMIT",
    );
  });

  it("rejects invalid limits", async () => {
    const { bytes } = await pdfWithImages([bigJpeg()]);
    expect(await failure(run(bytes, { maxImages: 0 }))).toBe("OUTPUT_LIMIT");
    expect(await failure(run(bytes, { imageBudgetMs: Number.NaN }))).toBe(
      "OUTPUT_LIMIT",
    );
  });

  it("rejects an unknown profile", async () => {
    const { bytes } = await pdfWithImages([bigJpeg()]);
    expect(
      await failure(
        compressPdf(
          input(bytes),
          "extreme" as never,
          limits(),
          {},
          { codec: fakeCodec() },
        ),
      ),
    ).toBe("INVALID_PLAN");
  });

  it("can be cancelled before and during the work", async () => {
    const { bytes } = await pdfWithImages([bigJpeg(), bigJpeg(), bigJpeg()], {
      onePagePerImage: true,
    });
    const early = new AbortController();
    early.abort();
    expect(
      await failure(
        compressPdf(
          input(bytes),
          "balanced",
          limits(),
          { signal: early.signal },
          { codec: fakeCodec() },
        ),
      ),
    ).toBe("CANCELLED");
    const late = new AbortController();
    const codec = fakeCodec();
    const aborting = {
      transcode: async (...args: Parameters<typeof codec.transcode>) => {
        late.abort();
        return codec.transcode(...args);
      },
    };
    expect(
      await failure(
        compressPdf(
          input(bytes),
          "balanced",
          limits(),
          { signal: late.signal },
          { codec: aborting },
        ),
      ),
    ).toBe("CANCELLED");
    expect(codec.calls).toHaveLength(1);
  });

  it("warns about digital signatures", async () => {
    const result = await run(fixtureBytes("signed.pdf"));
    expect(result.warnings).toContain("signatures");
    const plain = await run((await pdfWithImages([bigJpeg()])).bytes);
    expect(plain.warnings).not.toContain("signatures");
  });

  it("warns about PDF/A files", async () => {
    const { doc } = await pdfWithImages([bigJpeg()]);
    const xmp = doc.context.stream(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/></x:xmpmeta>',
      { Type: "Metadata", Subtype: "XML" } as never,
    );
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xmp));
    const result = await run(await doc.save());
    expect(result.warnings).toContain("pdfa");
  });

  it("keeps interactive form fields", async () => {
    const result = await compressPdf(
      input(fixtureBytes("form.pdf")),
      "balanced",
      limits(),
      {},
      { codec: fakeCodec() },
    );
    expect(result.pageCount).toBe(1);
    const before = await PDFDocument.load(fixtureBytes("form.pdf"));
    let candidate: Uint8Array = new Uint8Array();
    await compressPdf(
      input(fixtureBytes("form.pdf")),
      "balanced",
      limits(),
      {},
      {
        codec: fakeCodec(),
        onCandidate: (b) => (candidate = b),
      },
    );
    const after = await PDFDocument.load(candidate);
    expect(
      after
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(
      before
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    );
  });

  it("preserves page count, size and rotation", async () => {
    const source = fixtureBytes("preview-features.pdf");
    let candidate: Uint8Array = new Uint8Array();
    const result = await compressPdf(
      input(source),
      "balanced",
      limits(),
      {},
      {
        codec: fakeCodec(),
        onCandidate: (b) => (candidate = b),
      },
    );
    const [a, b] = [
      await PDFDocument.load(source),
      await PDFDocument.load(candidate),
    ];
    expect(result.pageCount).toBe(a.getPageCount());
    expect(
      b.getPages().map((p) => [p.getSize(), p.getRotation().angle]),
    ).toEqual(a.getPages().map((p) => [p.getSize(), p.getRotation().angle]));
  });

  it("publishes nothing when the file cannot be made meaningfully smaller", async () => {
    // A single JPEG already at target resolution and low quality: nothing to do.
    const { bytes } = await pdfWithImages([
      {
        width: 600,
        height: 400,
        kind: "jpeg",
        drawWidth: 300,
        drawHeight: 200,
        quality: 60,
        size: 300_000,
      },
    ]);
    const result = await run(bytes);
    expect(result.outcome).toBe("no-reduction");
    expect(result.blob).toBeUndefined();
    expect(result.outputBytes).toBeGreaterThan(result.inputBytes * 0.98);
    expect(result.images.optimized).toBe(0);
  });

  it("returns a verified PDF and truthful sizes when it reduces", async () => {
    const { bytes } = await pdfWithImages([bigJpeg()]);
    const result = await run(bytes);
    expect(result.outcome).toBe("reduced");
    const out = await bytesOf(result);
    expect(out.length).toBe(result.outputBytes);
    expect(result.inputBytes).toBe(bytes.length);
    expect(result.blob!.type).toBe("application/pdf");
    expect(new TextDecoder().decode(out.subarray(0, 5))).toBe("%PDF-");
    expect(result.pageCount).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.timingsMs.total).toBeGreaterThanOrEqual(0);
    expect(result.profile).toBe("balanced");
  });

  it("is deterministic", async () => {
    const { bytes } = await pdfWithImages([bigJpeg(), bigRaster()], {
      onePagePerImage: true,
    });
    const [a, b] = [await run(bytes), await run(bytes)];
    expect(await bytesOf(a)).toEqual(await bytesOf(b));
  });

  it("reports phases and image progress in order", async () => {
    const { bytes } = await pdfWithImages([bigJpeg(), bigJpeg()], {
      onePagePerImage: true,
    });
    const phases: string[] = [];
    const progress: [number, number][] = [];
    await compressPdf(
      input(bytes),
      "balanced",
      limits(),
      {
        onPhase: (p) => phases.push(p),
        onProgress: (p) => progress.push([p.done, p.total]),
      },
      { codec: fakeCodec() },
    );
    expect(phases).toEqual([
      "reading",
      "images",
      "structure",
      "saving",
      "verifying",
    ]);
    expect(progress[0]).toEqual([0, 2]);
    expect(progress.at(-1)).toEqual([2, 2]);
  });

  it("contains no document content in its result", async () => {
    const { bytes } = await pdfWithImages([bigJpeg()]);
    const json = JSON.stringify({ ...(await run(bytes)), blob: undefined });
    expect(json).not.toMatch(/compress-test|Im1|DCTDecode/);
  });
});
