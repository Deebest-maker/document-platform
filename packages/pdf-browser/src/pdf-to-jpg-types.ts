import type { PageErrorCode } from "./page-errors";

export type PdfJpegDpi = 96 | 150 | 300;
export type PdfToJpegPhase = "rendering" | "validating" | "archiving";

export interface PdfToJpegLimits {
  readonly maxSelectedPages: number;
  readonly maxPixelsPerPage: number;
  readonly maxAggregatePixels: number;
  readonly maxCanvasBytes: number;
  readonly maxCombinedOutputBytes: number;
  readonly maxArchiveBytes: number;
}

export interface PdfToJpegOptions {
  readonly dpi: PdfJpegDpi;
  readonly selectedIds: readonly string[] | "all";
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: {
    readonly phase: PdfToJpegPhase;
    readonly current: number;
    readonly total: number;
  }) => void;
}

export interface PdfToJpegResult {
  readonly blob: Blob;
  readonly kind: "jpg" | "zip";
  readonly fileCount: number;
  readonly combinedJpegBytes: number;
  readonly pages: readonly {
    readonly sourcePageNumber: number;
    readonly filename: string;
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
  }[];
}

export interface JpegInspection {
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

export type PdfToJpegErrorCode = PageErrorCode;
