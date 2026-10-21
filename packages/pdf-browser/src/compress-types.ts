// Types and constants for the on-device Compress PDF engine (ADR-025).

export const COMPRESS_PROFILE_IDS = ["light", "balanced", "strong"] as const;
export type CompressProfileId = (typeof COMPRESS_PROFILE_IDS)[number];

export interface CompressProfile {
  readonly id: CompressProfileId;
  // Images whose effective resolution is clearly above this are downsampled to
  // it (see `RESAMPLE_TOLERANCE`).
  readonly targetDpi: number;
  // JPEG quality used when an image is re-encoded, on the 1-100 scale that
  // most tools show.
  readonly jpegQuality: number;
}

export const compressProfiles: Readonly<
  Record<CompressProfileId, CompressProfile>
> = Object.freeze({
  light: Object.freeze({ id: "light", targetDpi: 220, jpegQuality: 85 }),
  balanced: Object.freeze({ id: "balanced", targetDpi: 150, jpegQuality: 75 }),
  strong: Object.freeze({ id: "strong", targetDpi: 110, jpegQuality: 60 }),
});

// The profile that is selected when the person has not chosen one.
export const DEFAULT_COMPRESS_PROFILE: CompressProfileId = "balanced";

// An image is only resampled when it is more than this factor above the
// profile's target resolution, so near-target images are not needlessly
// re-encoded for a negligible gain.
export const RESAMPLE_TOLERANCE = 1.25;
// A JPEG that is not resampled is only re-encoded when its estimated quality
// is at least this many points above the profile's quality.
export const RECODE_QUALITY_MARGIN = 8;
// A re-encoded image replaces the original only if it is at least this much
// smaller (fraction of the original stream length that must be saved).
export const MIN_IMAGE_SAVING = 0.1;
// A result smaller than the input by less than this fraction is reported as
// "no meaningful reduction" and is not offered for download.
export const MIN_FILE_SAVING = 0.01;

// Largest canvas the engine will ask a browser to create. Safari caps a canvas
// at about 16.7 million pixels; staying below that keeps output predictable on
// every supported browser.
export const MAX_CANVAS_PIXELS = 16_000_000;

export interface CompressLimits {
  readonly maxInputBytes: number;
  readonly maxPages: number;
  readonly maxOutputBytes: number;
  // Decode-size caps per image (pixels). Images above the cap are left alone.
  readonly maxJpegPixels: number;
  readonly maxRasterPixels: number;
  // Number of image XObjects that are considered (largest first).
  readonly maxImages: number;
  // Decompression-bomb guards for the lossless pass and Flate images.
  readonly maxStreamInflateBytes: number;
  readonly maxTotalInflateBytes: number;
  // Wall-clock budget for the image pass. Images that do not fit are left
  // unchanged and reported.
  readonly imageBudgetMs: number;
  // Total content-stream bytes the layout scanner may read.
  readonly maxScanBytes: number;
}

const MiB = 1024 * 1024;

// Engine-level defaults used by tests and tools. The web app builds its limits
// from the tool registry and the safety valves below (ADR-025).
export const DEFAULT_COMPRESS_LIMITS: CompressLimits = Object.freeze({
  maxInputBytes: 50 * MiB,
  maxPages: 1000,
  maxOutputBytes: 50 * MiB,
  maxJpegPixels: 64_000_000,
  maxRasterPixels: 32_000_000,
  maxImages: 1000,
  maxStreamInflateBytes: 128 * MiB,
  maxTotalInflateBytes: 768 * MiB,
  imageBudgetMs: 60_000,
  maxScanBytes: 128 * MiB,
});

export type CompressPhase =
  "reading" | "images" | "structure" | "saving" | "verifying";

export interface CompressProgress {
  readonly phase: CompressPhase;
  readonly done: number;
  readonly total: number;
}

export interface CompressOptions {
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: CompressPhase) => void;
  readonly onProgress?: (progress: CompressProgress) => void;
}

// Why an image was left as it was. Only counts leave the engine, never names
// or content.
export type ImageSkipReason =
  | "limit_images"
  | "too_large"
  | "not_raw"
  | "image_mask"
  | "has_mask"
  | "decode_array"
  | "bit_depth"
  | "color_space"
  | "filter"
  | "no_size"
  | "layout_unknown"
  | "shared_use"
  | "jpeg_unreadable"
  | "jpeg_mismatch"
  | "orientation"
  | "at_target"
  | "flat_graphic"
  | "not_smaller"
  | "raster_unreadable"
  | "decode_failed"
  | "time_budget"
  | "codec_unavailable";

export type ImageSkipCategory =
  "efficient" | "protected" | "limits" | "unreadable";

// Plain-language grouping used by the UI. Every reason belongs to one group.
export const IMAGE_SKIP_CATEGORY: Readonly<
  Record<ImageSkipReason, ImageSkipCategory>
> = Object.freeze({
  at_target: "efficient",
  flat_graphic: "efficient",
  not_smaller: "efficient",
  image_mask: "protected",
  has_mask: "protected",
  decode_array: "protected",
  bit_depth: "protected",
  color_space: "protected",
  filter: "protected",
  orientation: "protected",
  shared_use: "protected",
  layout_unknown: "protected",
  no_size: "protected",
  not_raw: "protected",
  limit_images: "limits",
  too_large: "limits",
  time_budget: "limits",
  codec_unavailable: "limits",
  jpeg_unreadable: "unreadable",
  jpeg_mismatch: "unreadable",
  raster_unreadable: "unreadable",
  decode_failed: "unreadable",
});

export type CompressWarning =
  "signatures" | "pdfa" | "images_unavailable" | "layout_unknown";

export interface CompressImageSummary {
  readonly found: number;
  readonly optimized: number;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  readonly skipped: Readonly<Partial<Record<ImageSkipReason, number>>>;
}

export interface CompressTimings {
  readonly load: number;
  readonly images: number;
  readonly structure: number;
  readonly save: number;
  readonly verify: number;
  readonly total: number;
}

export interface CompressResult {
  // "reduced": `blob` is a valid, smaller PDF. "no-reduction": the engine could
  // not make the file meaningfully smaller and publishes nothing.
  readonly outcome: "reduced" | "no-reduction";
  readonly blob?: Blob;
  readonly profile: CompressProfileId;
  readonly inputBytes: number;
  // Size of the best candidate, even when it was not published.
  readonly outputBytes: number;
  readonly pageCount: number;
  readonly images: CompressImageSummary;
  readonly streamsRecompressed: number;
  // Flate streams whose trailing checksum bytes had been lost while loading
  // (a known pdf-lib behaviour) and were rewritten correctly.
  readonly streamsRepaired: number;
  readonly warnings: readonly CompressWarning[];
  readonly timingsMs: CompressTimings;
}
