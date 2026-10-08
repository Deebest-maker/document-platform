import {
  ImagePdfError,
  type ImageInput,
  type ImageLimits,
  type ImagesToPdfOptions,
  type ImagesToPdfResult,
} from "./image-types";
import type {
  ImagesPdfRequest,
  ImagesPdfResponse,
} from "./image-worker-protocol";

export async function imagesToPdf(
  inputs: readonly ImageInput[],
  limits: ImageLimits,
  options: ImagesToPdfOptions,
): Promise<ImagesToPdfResult> {
  if (options.signal?.aborted) throw new ImagePdfError("CANCELLED");
  let worker: Worker;
  try {
    worker = new Worker(new URL("./images-to-pdf.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    throw new ImagePdfError("WORKER_UNAVAILABLE");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result?: ImagesToPdfResult, error?: ImagePdfError) => {
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
    const abort = () => finish(undefined, new ImagePdfError("CANCELLED"));
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<ImagesPdfResponse>) => {
      if (data.kind === "phase") options.onPhase?.(data.phase);
      else if (data.kind === "result") finish(data.result);
      else finish(undefined, new ImagePdfError(data.code, data.inputId));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(undefined, new ImagePdfError("GENERATION_FAILED"));
    };
    worker.onmessageerror = () =>
      finish(undefined, new ImagePdfError("GENERATION_FAILED"));
    try {
      const request: ImagesPdfRequest = {
        inputs: inputs.map((input) => ({
          id: input.id,
          blob: input.blob.slice(0, input.blob.size, input.inspection.mime),
          inspection: input.inspection,
        })),
        limits,
        options: {
          pageSize: options.pageSize,
          fit: options.fit,
          orientation: options.orientation,
        },
      };
      worker.postMessage(request);
    } catch {
      finish(undefined, new ImagePdfError("GENERATION_FAILED"));
    }
  });
}
