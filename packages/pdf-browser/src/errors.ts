import type { PdfErrorCode } from "./types";

// Never retain a parser exception/cause: it can include document-derived data.
export class PdfError extends Error {
  constructor(
    public readonly code: PdfErrorCode,
    public readonly inputId?: string,
  ) {
    super(code);
    this.name = "PdfError";
  }
}
