import { EncryptedPDFError, PDFDocument, ParseSpeeds } from "pdf-lib";
import { PdfError } from "./errors";
import { readPdfBytes, validateMergeInputs } from "./validation";
import type { MergeLimits, MergeOptions, MergeResult, PdfInput } from "./types";

const loadOptions = {
  ignoreEncryption: false,
  throwOnInvalidObject: true,
  updateMetadata: false,
  parseSpeed: ParseSpeeds.Slow,
};
// pdf-lib 1.17.1's ES5 Error subclass loses its prototype. Compare its fixed
// library-owned message as well; never expose or log the caught exception.
const encryptedMessage = new EncryptedPDFError().message;
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function mergePdfs(
  inputs: readonly PdfInput[],
  limits: MergeLimits,
  options: MergeOptions = {},
): Promise<MergeResult> {
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new PdfError("CANCELLED");
  };
  validateMergeInputs(inputs, limits);
  checkCancelled();
  try {
    const destination = await PDFDocument.create({ updateMetadata: false });
    let pageCount = 0;
    for (const input of inputs) {
      checkCancelled();
      options.onPhase?.("reading");
      await yieldTask();
      const bytes = await readPdfBytes(input);
      let source: PDFDocument;
      try {
        source = await PDFDocument.load(bytes, loadOptions);
        if (source.getPageCount() < 1)
          throw new PdfError("INVALID_PDF", input.id);
      } catch (error) {
        const encrypted =
          error instanceof EncryptedPDFError ||
          (error instanceof Error && error.message === encryptedMessage);
        throw new PdfError(
          encrypted ? "ENCRYPTED_PDF" : "INVALID_PDF",
          input.id,
        );
      }
      checkCancelled();
      pageCount += source.getPageCount();
      if (pageCount > limits.maxPages)
        throw new PdfError("PAGE_LIMIT", input.id);
      options.onPhase?.("merging");
      // One copier per source retains shared resources without rasterization.
      const pages = await destination.copyPages(
        source,
        source.getPageIndices(),
      );
      for (let index = 0; index < pages.length; index++) {
        destination.addPage(pages[index]);
        if (index % 16 === 0) {
          await yieldTask();
          checkCancelled();
        }
      }
    }
    checkCancelled();
    options.onPhase?.("validating");
    const bytes = await destination.save({
      addDefaultPage: false,
      objectsPerTick: 20,
      updateFieldAppearances: false,
    });
    checkCancelled();
    if (bytes.byteLength > limits.maxOutputBytes)
      throw new PdfError("OUTPUT_LIMIT");
    try {
      const reopened = await PDFDocument.load(bytes, loadOptions);
      if (reopened.getPageCount() !== pageCount || pageCount === 0)
        throw new PdfError("OUTPUT_INVALID");
    } catch {
      throw new PdfError("OUTPUT_INVALID");
    }
    checkCancelled();
    return {
      blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      pageCount,
      inputCount: inputs.length,
    };
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError("MERGE_FAILED");
  }
}
