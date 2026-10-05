import type { PageErrorCode } from "@document-platform/pdf-browser/pages";
import type { ToolShellState } from "@document-platform/ui";
import type { PageSnapshot } from "../pdf-preview/preview-session";

export const pageToolErrors: Record<PageErrorCode, string> = {
  INVALID_PLAN: "That page selection is not valid. Review it and try again.",
  INPUT_LIMIT: "Choose one PDF within the current size limit.",
  INVALID_PDF: "This PDF is damaged or unsupported. Choose another PDF.",
  ENCRYPTED_PDF:
    "Password-protected PDFs are not supported. Choose an unencrypted copy.",
  PAGE_LIMIT: "This PDF exceeds the current page limit.",
  OUTPUT_LIMIT: "The new PDF exceeds the current output limit.",
  OUTPUT_INVALID: "The result could not be validated. No download was created.",
  OPERATION_FAILED:
    "The new PDF could not be created. Try again with another file.",
  PREVIEW_FAILED: "The PDF preview could not open. Choose another PDF.",
  RENDER_FAILED: "A page preview could not be rendered.",
  CANCELLED: "Export cancelled. Your page choices are still available.",
  WORKER_UNAVAILABLE:
    "This browser could not start local PDF processing. Try an up-to-date browser.",
};

export const pagePhaseCopy = {
  reading: "Reading the source PDF locally…",
  transforming: "Writing the requested pages…",
  validating: "Reopening and validating the new PDF…",
};

export function pageToolState(snapshot: PageSnapshot): ToolShellState {
  if (snapshot.state === "empty") return "idle";
  if (snapshot.state === "loading" || snapshot.state === "exporting")
    return "processing";
  if (snapshot.state === "result") return "result";
  if (snapshot.state === "error") return "error";
  return "selected";
}
