import type { PageErrorCode } from "./page-errors";
import type { PageInput } from "./page-types";
import type {
  CompressLimits,
  CompressPhase,
  CompressProfileId,
  CompressProgress,
  CompressResult,
} from "./compress-types";

export interface CompressRequest {
  input: PageInput;
  profile: CompressProfileId;
  limits: CompressLimits;
}

export type CompressResponse =
  | { kind: "phase"; phase: CompressPhase }
  | { kind: "progress"; progress: CompressProgress }
  | { kind: "result"; result: CompressResult }
  | { kind: "error"; code: PageErrorCode };
