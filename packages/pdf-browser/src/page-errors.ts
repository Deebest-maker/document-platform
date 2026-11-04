export type PageErrorCode =
  | "INVALID_PLAN"
  | "INPUT_LIMIT"
  // The chosen file is empty, or is not named and typed as a PDF. Checked once,
  // for every PDF tool, by `validatePdfCandidate` before anything is read.
  | "EMPTY_INPUT"
  | "UNSUPPORTED_TYPE"
  | "INVALID_PDF"
  | "ENCRYPTED_PDF"
  | "PAGE_LIMIT"
  | "OUTPUT_LIMIT"
  | "OUTPUT_INVALID"
  | "OPERATION_FAILED"
  | "PREVIEW_FAILED"
  | "RENDER_FAILED"
  | "CANCELLED"
  | "WORKER_UNAVAILABLE"
  // The tool's own code could not be fetched (a dropped connection after the
  // page loaded, a blocked request). It says nothing about the chosen file.
  | "ENGINE_LOAD_FAILED";

// Safe, finite categories only. Never preserve a library cause or message.
export class PageError extends Error {
  constructor(public readonly code: PageErrorCode) {
    super(code);
    this.name = "PageError";
  }
}

// Wraps a dynamic `import()` of tool code. A rejected import means the code
// could not be fetched, not that the document is bad, so it gets its own code
// instead of falling into a generic "try another file" failure.
export async function loadEngineModule<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    throw new PageError("ENGINE_LOAD_FAILED");
  }
}
