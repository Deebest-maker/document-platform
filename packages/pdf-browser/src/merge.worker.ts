import "./quiet-worker-console";
import { mergePdfs } from "./merge";
import { PdfError } from "./errors";
import type { MergeRequest, MergeResponse } from "./worker-protocol";

// Only structured local messages cross this boundary. No URLs, names or logs.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MergeRequest>) => void) | null;
  postMessage: (message: MergeResponse) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    const result = await mergePdfs(data.inputs, data.limits, {
      onPhase: (phase) => scope.postMessage({ kind: "phase", phase }),
    });
    scope.postMessage({ kind: "result", result });
  } catch (error) {
    const safe =
      error instanceof PdfError ? error : new PdfError("MERGE_FAILED");
    scope.postMessage({
      kind: "error",
      code: safe.code,
      inputId: safe.inputId,
    });
  }
};
