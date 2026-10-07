export type ImageMime = "image/jpeg" | "image/png";
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type ImagePageSize = "auto" | "a4" | "letter";
export type ImageFit = "contain" | "cover";
export type ImagePageOrientation = "auto" | "portrait" | "landscape";

export interface ImageInspection {
  readonly mime: ImageMime;
  readonly width: number;
  readonly height: number;
  readonly orientation: ExifOrientation;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly pixels: number;
  readonly estimatedRgbaBytes: number;
}

export interface ImageLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxPages: number;
  readonly maxOutputBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixelsPerImage: number;
  readonly maxAggregatePixels: number;
  readonly maxDecodedBytesPerImage: number;
  readonly maxAggregateDecodedBytes: number;
}

export interface ImageInput {
  readonly id: string;
  readonly blob: Blob;
  readonly inspection: ImageInspection;
}

export interface ImagesToPdfOptions {
  readonly pageSize: ImagePageSize;
  readonly fit: ImageFit;
  readonly orientation: ImagePageOrientation;
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: ImagePdfPhase) => void;
}

export type ImagePdfPhase = "reading" | "generating" | "validating";

export interface ImagesToPdfResult {
  readonly blob: Blob;
  readonly pageCount: number;
  readonly outputBytes: number;
}

export type ImageErrorCode =
  | "INPUT_COUNT"
  | "EMPTY_INPUT"
  | "UNSUPPORTED_TYPE"
  | "SIGNATURE_MISMATCH"
  | "INVALID_IMAGE"
  | "INPUT_LIMIT"
  | "DIMENSION_LIMIT"
  | "PIXEL_LIMIT"
  | "AGGREGATE_PIXEL_LIMIT"
  | "OUTPUT_LIMIT"
  | "OUTPUT_INVALID"
  | "PREVIEW_FAILED"
  | "GENERATION_FAILED"
  | "CANCELLED"
  | "WORKER_UNAVAILABLE";

export class ImagePdfError extends Error {
  constructor(
    public readonly code: ImageErrorCode,
    public readonly inputId?: string,
  ) {
    super(code);
    this.name = "ImagePdfError";
  }
}
