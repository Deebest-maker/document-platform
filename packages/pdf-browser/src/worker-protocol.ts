import type {
  MergeLimits,
  MergePhase,
  MergeResult,
  PdfErrorCode,
  PdfInput,
} from "./types";

export interface MergeRequest {
  inputs: readonly PdfInput[];
  limits: MergeLimits;
}
export type MergeResponse =
  | { kind: "phase"; phase: MergePhase }
  | { kind: "result"; result: MergeResult }
  | { kind: "error"; code: PdfErrorCode; inputId?: string };
