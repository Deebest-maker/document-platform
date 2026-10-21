import "./quiet-worker-console";
import { compressPdf } from "./compress-pdf";
import type {
  CompressRequest,
  CompressResponse,
} from "./compress-worker-protocol";
import { PageError } from "./page-errors";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CompressRequest>) => void) | null;
  postMessage: (message: CompressResponse) => void;
};

scope.onmessage = async ({ data }) => {
  try {
    const result = await compressPdf(data.input, data.profile, data.limits, {
      onPhase: (phase) => scope.postMessage({ kind: "phase", phase }),
      onProgress: (progress) =>
        scope.postMessage({ kind: "progress", progress }),
    });
    scope.postMessage({ kind: "result", result });
  } catch (error) {
    scope.postMessage({
      kind: "error",
      code: error instanceof PageError ? error.code : "OPERATION_FAILED",
    });
  }
};
