export interface MergeLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxPages: number;
  readonly maxOutputBytes: number;
}

export interface PdfInput {
  readonly id: string;
  readonly blob: Blob;
}

export type MergePhase = "reading" | "merging" | "validating";
export interface MergeOptions {
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: MergePhase) => void;
}

export interface MergeResult {
  readonly blob: Blob;
  readonly pageCount: number;
  readonly inputCount: number;
}

export type PdfErrorCode =
  | "INPUT_COUNT"
  | "EMPTY_INPUT"
  | "UNSUPPORTED_TYPE"
  | "INPUT_LIMIT"
  | "UNREADABLE_FILE"
  | "ENCRYPTED_PDF"
  | "INVALID_PDF"
  | "PAGE_LIMIT"
  | "OUTPUT_LIMIT"
  | "OUTPUT_INVALID"
  | "MERGE_FAILED"
  | "CANCELLED"
  | "WORKER_UNAVAILABLE";
