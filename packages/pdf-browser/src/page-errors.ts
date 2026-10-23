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
  | "WORKER_UNAVAILABLE";

// Safe, finite categories only. Never preserve a library cause or message.
export class PageError extends Error {
  constructor(public readonly code: PageErrorCode) {
    super(code);
    this.name = "PageError";
  }
}
