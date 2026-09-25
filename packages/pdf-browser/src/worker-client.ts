import { PdfError } from "./errors";
import { validateMergeInputs } from "./validation";
import type { MergeLimits, MergeOptions, MergeResult, PdfInput } from "./types";
import type { MergeRequest, MergeResponse } from "./worker-protocol";

export async function mergePdfs(
  inputs: readonly PdfInput[],
  limits: MergeLimits,
  options: MergeOptions = {},
): Promise<MergeResult> {
  validateMergeInputs(inputs, limits);
  if (options.signal?.aborted) throw new PdfError("CANCELLED");
  let worker: Worker;
  try {
    worker = new Worker(new URL("./merge.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    throw new PdfError("WORKER_UNAVAILABLE");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result?: MergeResult, error?: PdfError) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(undefined, new PdfError("CANCELLED"));
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<MergeResponse>) => {
      if (settled) return;
      if (data.kind === "phase") options.onPhase?.(data.phase);
      else if (data.kind === "result") finish(data.result);
      else finish(undefined, new PdfError(data.code, data.inputId));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(undefined, new PdfError("MERGE_FAILED"));
    };
    worker.onmessageerror = () =>
      finish(undefined, new PdfError("MERGE_FAILED"));
    try {
      // Slice Files into plain Blobs: even local worker messages omit names.
      const request: MergeRequest = {
        inputs: inputs.map(({ id, blob }) => ({
          id,
          blob: blob.slice(0, blob.size, blob.type),
        })),
        limits,
      };
      worker.postMessage(request);
    } catch {
      finish(undefined, new PdfError("MERGE_FAILED"));
    }
  });
}
