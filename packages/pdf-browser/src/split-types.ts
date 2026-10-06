import type { PagePlan } from "./page-model";
import type { PageErrorCode } from "./page-errors";
import type { PageInput, PageLimits } from "./page-types";

export interface SplitLimits {
  readonly maxOutputs: number;
  readonly maxCombinedPdfBytes: number;
  readonly maxArchiveBytes: number;
}
export type SplitPhase =
  "reading" | "transforming" | "validating" | "archiving";
export interface SplitOptions {
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: SplitPhase) => void;
}
export interface SplitResult {
  readonly blob: Blob;
  readonly kind: "pdf" | "zip";
  readonly fileCount: number;
  readonly pageCount: number;
  readonly combinedPdfBytes: number;
}
export interface SplitRequest {
  input: PageInput;
  plans: readonly PagePlan[];
  pageLimits: PageLimits;
  splitLimits: SplitLimits;
}
export type SplitResponse =
  | { kind: "phase"; phase: SplitPhase }
  | { kind: "result"; result: SplitResult }
  | { kind: "error"; code: PageErrorCode };
