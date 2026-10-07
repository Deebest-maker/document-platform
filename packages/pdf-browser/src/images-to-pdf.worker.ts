import "./quiet-worker-console";
import { createImagesPdf } from "./image-operations";
import { ImagePdfError } from "./image-types";
import type {
  ImagesPdfRequest,
  ImagesPdfResponse,
} from "./image-worker-protocol";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ImagesPdfRequest>) => void) | null;
  postMessage: (message: ImagesPdfResponse) => void;
};

scope.onmessage = async ({ data }) => {
  try {
    const result = await createImagesPdf(data.inputs, data.limits, {
      ...data.options,
      onPhase: (phase) => scope.postMessage({ kind: "phase", phase }),
    });
    scope.postMessage({ kind: "result", result });
  } catch (error) {
    const safe =
      error instanceof ImagePdfError
        ? error
        : new ImagePdfError("GENERATION_FAILED");
    scope.postMessage({
      kind: "error",
      code: safe.code,
      inputId: safe.inputId,
    });
  }
};
