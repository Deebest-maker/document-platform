import "./quiet-worker-console";
import { PageError } from "./page-errors";
import { splitPdf } from "./split-operations";
import type { SplitRequest, SplitResponse } from "./split-types";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SplitRequest>) => void) | null;
  postMessage: (message: SplitResponse) => void;
};

scope.onmessage = async ({ data }) => {
  try {
    const result = await splitPdf(
      data.input,
      data.plans,
      data.pageLimits,
      data.splitLimits,
      { onPhase: (phase) => scope.postMessage({ kind: "phase", phase }) },
    );
    scope.postMessage({ kind: "result", result });
  } catch (error) {
    scope.postMessage({
      kind: "error",
      code: error instanceof PageError ? error.code : "OPERATION_FAILED",
    });
  }
};
