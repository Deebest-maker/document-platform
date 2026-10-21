import { COMPRESS_PROFILE_IDS } from "./compress-types";
import type {
  CompressLimits,
  CompressOptions,
  CompressProfileId,
  CompressResult,
} from "./compress-types";
import type {
  CompressRequest,
  CompressResponse,
} from "./compress-worker-protocol";
import { PageError } from "./page-errors";
import type { PageInput } from "./page-types";
import { validatePageInput } from "./page-validation";

// Runs one compression in a dedicated worker. The worker is terminated when the
// operation settles or is cancelled, which releases all of its memory.
export async function compressPdfInWorker(
  input: PageInput,
  profile: CompressProfileId,
  limits: CompressLimits,
  options: CompressOptions = {},
): Promise<CompressResult> {
  validatePageInput(input, limits);
  if (!COMPRESS_PROFILE_IDS.includes(profile))
    throw new PageError("INVALID_PLAN");
  if (options.signal?.aborted) throw new PageError("CANCELLED");
  let worker: Worker;
  try {
    worker = new Worker(new URL("./compress.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    throw new PageError("WORKER_UNAVAILABLE");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result?: CompressResult, error?: PageError) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(undefined, new PageError("CANCELLED"));
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<CompressResponse>) => {
      if (settled) return;
      if (data.kind === "phase") options.onPhase?.(data.phase);
      else if (data.kind === "progress") options.onProgress?.(data.progress);
      else if (data.kind === "result") finish(data.result);
      else finish(undefined, new PageError(data.code));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(undefined, new PageError("OPERATION_FAILED"));
    };
    worker.onmessageerror = () =>
      finish(undefined, new PageError("OPERATION_FAILED"));
    try {
      const request: CompressRequest = {
        input: {
          id: input.id,
          blob: input.blob.slice(0, input.blob.size, input.blob.type),
        },
        profile,
        limits,
      };
      worker.postMessage(request);
    } catch {
      finish(undefined, new PageError("OPERATION_FAILED"));
    }
  });
}

export { PageError } from "./page-errors";
export type { PageErrorCode } from "./page-errors";
export {
  COMPRESS_PROFILE_IDS,
  DEFAULT_COMPRESS_LIMITS,
  DEFAULT_COMPRESS_PROFILE,
  IMAGE_SKIP_CATEGORY,
  MIN_FILE_SAVING,
  compressProfiles,
} from "./compress-types";
export type {
  CompressImageSummary,
  CompressLimits,
  CompressOptions,
  CompressPhase,
  CompressProfile,
  CompressProfileId,
  CompressProgress,
  CompressResult,
  CompressWarning,
  ImageSkipCategory,
  ImageSkipReason,
} from "./compress-types";
