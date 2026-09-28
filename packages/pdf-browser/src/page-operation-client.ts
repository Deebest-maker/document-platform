import { PageError } from "./page-errors";
import { validatePagePlan, type PagePlan } from "./page-model";
import { validatePageInput } from "./page-validation";
import type {
  PageInput,
  PageLimits,
  PageOperationOptions,
  PageRequest,
  PageResponse,
  PageResult,
} from "./page-types";

export async function transformPages(
  input: PageInput,
  plan: PagePlan,
  limits: PageLimits,
  options: PageOperationOptions = {},
): Promise<PageResult> {
  validatePageInput(input, limits);
  validatePagePlan(plan);
  if (input.id !== plan.sessionId) throw new PageError("INVALID_PLAN");
  if (options.signal?.aborted) throw new PageError("CANCELLED");
  let worker: Worker;
  try {
    worker = new Worker(
      new URL("./page-operations.worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch {
    throw new PageError("WORKER_UNAVAILABLE");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result?: PageResult, error?: PageError) => {
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
    worker.onmessage = ({ data }: MessageEvent<PageResponse>) => {
      if (settled) return;
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
    try {
      const request: PageRequest = {
        input: {
          id: input.id,
          blob: input.blob.slice(0, input.blob.size, input.blob.type),
        },
        plan,
        limits,
      };
      worker.postMessage(request);
    } catch {
      finish(undefined, new PageError("OPERATION_FAILED"));
    }
  });
}
export { pageLimits } from "./page-types";
export type {
  PageInput,
  PageLimits,
  PageOperationOptions,
  PageResult,
} from "./page-types";
export { PageError } from "./page-errors";
