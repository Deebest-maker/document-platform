import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFDict,
  type PDFPage,
} from "pdf-lib";
import { zlibSync } from "fflate";
import type { CodecSource, ImageCodec } from "../../src/compress-codec";

// Natural-order ITU T.81 Annex K luminance table (quality 50).
const BASE_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

export function quantTable(quality: number): number[] {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  return BASE_LUMA.map((value) =>
    Math.max(1, Math.min(255, Math.floor((value * scale + 50) / 100))),
  );
}

export interface JpegSpec {
  readonly width: number;
  readonly height: number;
  readonly components?: 1 | 3 | 4;
  readonly quality?: number;
  readonly orientation?: number;
  readonly bigEndianExif?: boolean;
  readonly progressive?: boolean;
  readonly wideTables?: boolean;
  // Total length to pad to (entropy-coded filler).
  readonly size?: number;
}

const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];

// Header-complete, pixel-free JPEG bytes: enough for the engine's inspection.
export function jpegBytes(spec: JpegSpec): Uint8Array {
  const components = spec.components ?? 3;
  const out: number[] = [0xff, 0xd8];
  if (spec.orientation !== undefined) {
    const big = spec.bigEndianExif ?? false;
    const short = (v: number) => (big ? u16(v) : [v & 0xff, (v >> 8) & 0xff]);
    const long = (v: number) =>
      big ? [0, 0, ...u16(v)] : [v & 0xff, (v >> 8) & 0xff, 0, 0];
    const tiff = [
      ...(big ? [0x4d, 0x4d] : [0x49, 0x49]),
      ...short(42),
      ...long(8),
      ...short(1),
      ...short(0x0112),
      ...short(3),
      ...long(1),
      ...short(spec.orientation),
      0,
      0,
      ...long(0),
    ];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    out.push(0xff, 0xe1, ...u16(body.length + 2), ...body);
  }
  const table = quantTable(spec.quality ?? 85);
  if (spec.wideTables) {
    out.push(0xff, 0xdb, ...u16(2 + 1 + 128), 0x10);
    for (const value of table) out.push(...u16(value));
  } else {
    out.push(0xff, 0xdb, ...u16(2 + 1 + 64), 0x00, ...table);
  }
  out.push(
    0xff,
    spec.progressive ? 0xc2 : 0xc0,
    ...u16(8 + 3 * components),
    8,
    ...u16(spec.height),
    ...u16(spec.width),
    components,
  );
  for (let index = 0; index < components; index++) out.push(index + 1, 0x11, 0);
  out.push(0xff, 0xda, ...u16(6 + 2 * components), components);
  for (let index = 0; index < components; index++) out.push(index + 1, 0);
  out.push(0, 63, 0);
  const total = Math.max(spec.size ?? 0, out.length + 2);
  const bytes = new Uint8Array(total);
  bytes.set(out);
  bytes[total - 2] = 0xff;
  bytes[total - 1] = 0xd9;
  return bytes;
}

// Deterministic photo-like noise: incompressible enough that Flate cannot
// shrink it, and not "flat" for the graphics test.
export function noiseSamples(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[index] = state >>> 24;
  }
  return out;
}

export interface FakeCodec extends ImageCodec {
  readonly calls: {
    source: CodecSource["kind"];
    width: number;
    height: number;
    quality: number;
  }[];
}

// Returns a header-only JPEG of the requested size; `ratio` is bytes per pixel.
export function fakeCodec(
  options: { ratio?: number; fail?: boolean; wrongSize?: boolean } = {},
): FakeCodec {
  const calls: FakeCodec["calls"] = [];
  return {
    calls,
    async transcode(source, width, height, quality) {
      calls.push({ source: source.kind, width, height, quality });
      if (options.fail) throw new Error("decode failed");
      return jpegBytes({
        width: options.wrongSize ? width + 1 : width,
        height,
        components: 3,
        quality,
        size: Math.max(
          400,
          Math.round(width * height * (options.ratio ?? 0.05)),
        ),
      });
    },
  };
}

export interface ImageSpec {
  readonly width: number;
  readonly height: number;
  readonly kind: "jpeg" | "flate" | "raw";
  readonly color?: "gray" | "rgb";
  readonly quality?: number;
  readonly orientation?: number;
  // Stored size for JPEGs; raster size follows from the samples.
  readonly size?: number;
  // Placement on the page, in points.
  readonly drawWidth: number;
  readonly drawHeight: number;
  readonly flat?: boolean;
  readonly seed?: number;
  readonly configure?: (dict: PDFDict, doc: PDFDocument) => void;
}

export function rasterSamples(spec: ImageSpec): Uint8Array {
  const channels = spec.color === "gray" ? 1 : 3;
  const length = spec.width * spec.height * channels;
  if (!spec.flat) return noiseSamples(length, spec.seed ?? 7);
  const out = new Uint8Array(length);
  out.fill(255);
  for (let row = 0; row < spec.height; row += 40)
    out.fill(0, row * spec.width * channels, (row + 1) * spec.width * channels);
  return out;
}

export function addImage(
  doc: PDFDocument,
  page: PDFPage,
  spec: ImageSpec,
  position = { x: 20, y: 20 },
): PDFRef {
  const channels = spec.color === "gray" ? 1 : 3;
  let contents: Uint8Array;
  const entries: Record<string, unknown> = {
    Type: "XObject",
    Subtype: "Image",
    Width: spec.width,
    Height: spec.height,
    BitsPerComponent: 8,
    ColorSpace: spec.color === "gray" ? "DeviceGray" : "DeviceRGB",
  };
  if (spec.kind === "jpeg") {
    contents = jpegBytes({
      width: spec.width,
      height: spec.height,
      components: channels,
      quality: spec.quality ?? 90,
      orientation: spec.orientation,
      size: spec.size ?? 200_000,
    });
    entries.Filter = "DCTDecode";
  } else if (spec.kind === "flate") {
    contents = zlibSync(rasterSamples(spec), { level: 1 });
    entries.Filter = "FlateDecode";
  } else {
    contents = rasterSamples(spec);
  }
  const stream = doc.context.stream(contents, entries as never);
  spec.configure?.(stream.dict, doc);
  const ref = doc.context.register(stream);
  const tag = page.node.newXObject("Im", ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      spec.drawWidth,
      0,
      0,
      spec.drawHeight,
      position.x,
      position.y,
    ),
    drawObject(tag),
    popGraphicsState(),
  );
  return ref;
}

export async function pdfWithImages(
  images: readonly ImageSpec[],
  options: { pageSize?: [number, number]; onePagePerImage?: boolean } = {},
): Promise<{ bytes: Uint8Array; doc: PDFDocument; refs: PDFRef[] }> {
  const doc = await PDFDocument.create();
  const size = options.pageSize ?? [612, 792];
  let page = doc.addPage(size);
  const refs: PDFRef[] = [];
  for (const spec of images) {
    if (options.onePagePerImage && refs.length > 0) page = doc.addPage(size);
    refs.push(addImage(doc, page, spec));
  }
  return { bytes: await doc.save({ useObjectStreams: false }), doc, refs };
}

export const num = (value: number) => PDFNumber.of(value);
export const nm = (value: string) => PDFName.of(value);
