import type { PagePlan } from "./page-model";
import type { PageErrorCode } from "./page-errors";

export interface PageLimits {
  readonly maxInputBytes: number;
  readonly maxPages: number;
  readonly maxOutputBytes: number;
}
export const pageLimits: PageLimits = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024,
  maxPages: 200,
  maxOutputBytes: 32 * 1024 * 1024,
});
export interface PageInput {
  readonly id: string;
  readonly blob: Blob;
}
export interface PageResult {
  readonly blob: Blob;
  readonly pageCount: number;
}
export type PagePhase = "reading" | "transforming" | "validating";
export interface PageOperationOptions {
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: PagePhase) => void;
}
export interface PageRequest {
  input: PageInput;
  plan: PagePlan;
  limits: PageLimits;
}
export type PageResponse =
  | { kind: "phase"; phase: PagePhase }
  | { kind: "result"; result: PageResult }
  | { kind: "error"; code: PageErrorCode };
