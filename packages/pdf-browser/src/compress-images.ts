import {
  PDFArray,
  PDFDict,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  type PDFContext,
  type PDFRef,
} from "pdf-lib";
import type { CodecSource, ImageCodec } from "./compress-codec";
import { inspectJpeg } from "./compress-jpeg";
import { inflateZlibBounded } from "./compress-inflate";
import type { LayoutResult } from "./compress-layout";
import { planImage } from "./compress-plan";
import { filterNames, flateParams, name, numberOf } from "./compress-pdfobj";
import { flatFraction, samplesToRgba, undoPredictor } from "./compress-raster";
import {
  MIN_IMAGE_SAVING,
  type CompressImageSummary,
  type CompressLimits,
  type CompressProfile,
  type ImageSkipReason,
} from "./compress-types";

const MAX_IMAGE_DIMENSION = 100_000;
const FLAT_GRAPHIC_THRESHOLD = 0.5;

export interface TouchedStream {
  readonly ref: PDFRef;
  readonly length: number;
  readonly jpeg: boolean;
}

export interface InflateBudget {
  remaining: number;
}

export interface ImagePassInput {
  readonly context: PDFContext;
  readonly layout: LayoutResult;
  readonly profile: CompressProfile;
  readonly limits: CompressLimits;
  // Undefined when the browser has no usable image codec.
  readonly codec: ImageCodec | undefined;
  readonly now: () => number;
  readonly inflate: InflateBudget;
  readonly touched: TouchedStream[];
  readonly checkCancelled: () => void;
  readonly onProgress: (done: number, total: number) => void;
}

interface ColorInfo {
  readonly channels: 1 | 3;
  // True when the colour space is a 3-component ICC profile, which is kept.
  readonly keep: boolean;
}

// DeviceGray, DeviceRGB and 3-component ICC profiles only. Anything else
// (CMYK, Indexed, Cal*, Lab, Separation, 1-component ICC, ...) is left alone.
function colorInfo(context: PDFContext, dict: PDFDict): ColorInfo | undefined {
  const value = context.lookup(dict.get(name("ColorSpace")));
  if (value === name("DeviceGray")) return { channels: 1, keep: false };
  if (value === name("DeviceRGB")) return { channels: 3, keep: true };
  if (value instanceof PDFArray && value.size() === 2) {
    const family = context.lookup(value.get(0));
    const profile = context.lookup(value.get(1));
    if (family === name("ICCBased") && profile instanceof PDFStream) {
      const components = context.lookupMaybe(
        profile.dict.get(name("N")),
        PDFNumber,
      );
      if (components?.asNumber() === 3) return { channels: 3, keep: true };
    }
  }
  return undefined;
}

type Prepared =
  | { readonly skip: ImageSkipReason }
  | {
      readonly source: CodecSource;
      readonly width: number;
      readonly height: number;
      readonly resized: boolean;
      readonly colors: ColorInfo;
    };

function decodeRaster(
  context: PDFContext,
  stream: PDFRawStream,
  width: number,
  height: number,
  colors: ColorInfo,
  filters: readonly string[],
  input: ImagePassInput,
): Uint8Array | ImageSkipReason {
  let samples: Uint8Array;
  if (filters.length === 0) {
    samples = stream.contents;
    if (samples.length > input.limits.maxStreamInflateBytes) return "too_large";
  } else {
    const params = flateParams(context, stream.dict);
    if (!params) return "raster_unreadable";
    const allowed = Math.min(
      input.limits.maxStreamInflateBytes,
      Math.max(0, input.inflate.remaining),
    );
    const result = inflateZlibBounded(stream.contents, allowed);
    if (!result.ok)
      return result.reason === "limit" ? "too_large" : "raster_unreadable";
    if (result.trailer === "invalid") return "raster_unreadable";
    input.inflate.remaining -= result.bytes.length;
    samples = result.bytes;
    if (params.predictor !== 1) {
      if (
        params.columns !== width ||
        params.colors !== colors.channels ||
        params.bitsPerComponent !== 8
      )
        return "raster_unreadable";
      const plain = undoPredictor(
        samples,
        {
          predictor: params.predictor,
          columns: params.columns,
          colors: params.colors,
        },
        height,
      );
      if (!plain) return "raster_unreadable";
      samples = plain;
    }
  }
  return samples.length === width * height * colors.channels
    ? samples
    : "raster_unreadable";
}

function prepare(
  stream: PDFRawStream,
  use: { readonly width: number; readonly height: number },
  input: ImagePassInput,
): Prepared {
  const { context, profile, limits } = input;
  const dict = stream.dict;
  if (dict.has(name("ImageMask"))) return { skip: "image_mask" };
  if (dict.has(name("SMask")) || dict.has(name("Mask")))
    return { skip: "has_mask" };
  if (dict.has(name("Decode"))) return { skip: "decode_array" };
  if (numberOf(context, dict, "BitsPerComponent") !== 8)
    return { skip: "bit_depth" };
  const colors = colorInfo(context, dict);
  if (!colors) return { skip: "color_space" };
  const filters = filterNames(context, dict);
  if (!filters) return { skip: "filter" };
  const isJpeg = filters.length === 1 && filters[0] === "DCTDecode";
  const isRaster =
    filters.length === 0 ||
    (filters.length === 1 && filters[0] === "FlateDecode");
  if (!isJpeg && !isRaster) return { skip: "filter" };
  const width = numberOf(context, dict, "Width");
  const height = numberOf(context, dict, "Height");
  if (
    width === undefined ||
    height === undefined ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION
  )
    return { skip: "raster_unreadable" };
  const pixels = width * height;
  if (pixels > (isJpeg ? limits.maxJpegPixels : limits.maxRasterPixels))
    return { skip: "too_large" };

  let jpegQuality: number | undefined;
  if (isJpeg) {
    const info = inspectJpeg(stream.contents);
    if (!info || info.precision !== 8) return { skip: "jpeg_unreadable" };
    if (
      info.width !== width ||
      info.height !== height ||
      info.components !== colors.channels
    )
      return { skip: "jpeg_mismatch" };
    // The PDF ignores EXIF orientation but some viewers do not; re-encoding
    // would silently drop it, so such images are left untouched.
    if (info.orientation !== 1) return { skip: "orientation" };
    jpegQuality = info.quality;
  }

  const plan = planImage(
    {
      width,
      height,
      usedWidth: use.width,
      usedHeight: use.height,
      kind: isJpeg ? "jpeg" : "raster",
      jpegQuality,
    },
    profile,
  );
  if (plan.action === "skip") return { skip: plan.reason };

  if (isJpeg)
    return {
      source: { kind: "jpeg", bytes: stream.contents },
      width: plan.width,
      height: plan.height,
      resized: plan.resized,
      colors,
    };
  // Raster images are decoded here so flat graphics can be rejected before any
  // lossy step; they stay lossless.
  const samples = decodeRaster(
    context,
    stream,
    width,
    height,
    colors,
    filters,
    input,
  );
  if (!(samples instanceof Uint8Array)) return { skip: samples };
  if (
    flatFraction(samples, width, height, colors.channels) >
    FLAT_GRAPHIC_THRESHOLD
  )
    return { skip: "flat_graphic" };
  return {
    source: {
      kind: "rgba",
      width,
      height,
      data: samplesToRgba(samples, width * height, colors.channels),
    },
    width: plan.width,
    height: plan.height,
    resized: plan.resized,
    colors,
  };
}

export async function optimizeImages(
  input: ImagePassInput,
): Promise<CompressImageSummary> {
  const { layout, limits, profile, codec, now } = input;
  const skipped: Partial<Record<ImageSkipReason, number>> = {};
  const skip = (reason: ImageSkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  // Largest first: the biggest images give the most saving, and they are the
  // ones to keep if a limit cuts the pass short.
  const candidates = [...layout.uses.values()].sort(
    (a, b) => b.stream.contents.length - a.stream.contents.length,
  );
  let optimized = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  const started = now();
  for (let index = 0; index < candidates.length; index++) {
    input.checkCancelled();
    input.onProgress(index, candidates.length);
    const use = candidates[index];
    if (!codec) {
      skip("codec_unavailable");
      continue;
    }
    if (index >= limits.maxImages) {
      skip("limit_images");
      continue;
    }
    if (now() - started > limits.imageBudgetMs) {
      skip("time_budget");
      continue;
    }
    if (layout.shared.has(use.ref.objectNumber)) {
      skip("shared_use");
      continue;
    }
    const prepared = prepare(use.stream, use, input);
    if ("skip" in prepared) {
      skip(prepared.skip);
      continue;
    }
    const original = use.stream.contents.length;
    let encoded: Uint8Array;
    try {
      encoded = await codec.transcode(
        prepared.source,
        prepared.width,
        prepared.height,
        profile.jpegQuality,
      );
    } catch {
      skip("decode_failed");
      continue;
    }
    const check = inspectJpeg(encoded);
    if (
      !check ||
      check.width !== prepared.width ||
      check.height !== prepared.height ||
      check.components !== 3
    ) {
      skip("decode_failed");
      continue;
    }
    if (encoded.length > original * (1 - MIN_IMAGE_SAVING)) {
      skip("not_smaller");
      continue;
    }
    const dict = use.stream.dict;
    dict.set(name("Width"), PDFNumber.of(prepared.width));
    dict.set(name("Height"), PDFNumber.of(prepared.height));
    dict.set(name("BitsPerComponent"), PDFNumber.of(8));
    dict.set(name("Filter"), name("DCTDecode"));
    dict.delete(name("DecodeParms"));
    // Grey images are re-encoded as RGB (the canvas encoder has no grey mode).
    if (!prepared.colors.keep) dict.set(name("ColorSpace"), name("DeviceRGB"));
    (use.stream as { contents: Uint8Array }).contents = encoded;
    input.touched.push({ ref: use.ref, length: encoded.length, jpeg: true });
    optimized++;
    bytesBefore += original;
    bytesAfter += encoded.length;
  }
  input.onProgress(candidates.length, candidates.length);
  return Object.freeze({
    found: candidates.length,
    optimized,
    bytesBefore,
    bytesAfter,
    skipped: Object.freeze({ ...skipped }),
  });
}
