import "./quiet-worker-console";
import { transformPages } from "./page-operations";
import { PageError } from "./page-errors";
import type { PageRequest, PageResponse } from "./page-types";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PageRequest>) => void) | null;
  postMessage: (message: PageResponse) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    const result = await transformPages(data.input, data.plan, data.limits, {
      onPhase: (phase) => scope.postMessage({ kind: "phase", phase }),
    });
    scope.postMessage({ kind: "result", result });
  } catch (error) {
    scope.postMessage({
      kind: "error",
      code: error instanceof PageError ? error.code : "OPERATION_FAILED",
    });
  }
};
