import { PageError } from "./page-errors";
import { validatePageInput } from "./page-validation";
import { splitLimits as defaultSplitLimits } from "./split-plan";
import type { PagePlan } from "./page-model";
import type { PageInput, PageLimits } from "./page-types";
import type {
  SplitLimits,
  SplitOptions,
  SplitRequest,
  SplitResponse,
  SplitResult,
} from "./split-types";

export function splitPdf(
  input: PageInput,
  plans: readonly PagePlan[],
  pageLimits: PageLimits,
  options: SplitOptions = {},
  limits: SplitLimits = defaultSplitLimits,
): Promise<SplitResult> {
  validatePageInput(input, pageLimits);
  if (options.signal?.aborted)
    return Promise.reject(new PageError("CANCELLED"));
  let worker: Worker;
  try {
    worker = new Worker(new URL("./split.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return Promise.reject(new PageError("WORKER_UNAVAILABLE"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result?: SplitResult, error?: PageError) => {
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
    worker.onmessage = ({ data }: MessageEvent<SplitResponse>) => {
      if (data.kind === "phase") options.onPhase?.(data.phase);
      else if (data.kind === "result") finish(data.result);
      else finish(undefined, new PageError(data.code));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(undefined, new PageError("OPERATION_FAILED"));
    };
    worker.onmessageerror = () =>
      finish(undefined, new PageError("OPERATION_FAILED"));
    const request: SplitRequest = {
      input: {
        id: input.id,
        blob: input.blob.slice(0, input.blob.size, input.blob.type),
      },
      plans,
      pageLimits,
      splitLimits: limits,
    };
    try {
      worker.postMessage(request);
    } catch {
      finish(undefined, new PageError("OPERATION_FAILED"));
    }
  });
}

export { splitLimits } from "./split-plan";
export type {
  SplitLimits,
  SplitOptions,
  SplitPhase,
  SplitResult,
} from "./split-types";
