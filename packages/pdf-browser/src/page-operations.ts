import {
  PDFDocument,
  PDFArray,
  PDFRawStream,
  PDFName,
  EncryptedPDFError,
  ParseSpeeds,
  degrees,
  type PDFPage,
} from "pdf-lib";
import { PageError } from "./page-errors";
import {
  normalizeRotation,
  validatePagePlan,
  type PagePlan,
} from "./page-model";
import { readPageInput, validatePageInput } from "./page-validation";
import type {
  PageInput,
  PageLimits,
  PageOperationOptions,
  PageResult,
} from "./page-types";

const loadOptions = {
  ignoreEncryption: false,
  throwOnInvalidObject: true,
  updateMetadata: false,
  parseSpeed: ParseSpeeds.Slow,
};
const encryptedMessage = new EncryptedPDFError().message;

// Saved pages must retain the ordered source content streams, boxes and rotation.
// Comparing encoded stream bytes also works for binary/image-bearing content;
// no extracted text or document-derived fingerprints leave the operation worker.
async function signature(page: PDFPage, rotation = page.getRotation().angle) {
  const contents = page.node.lookup(PDFName.of("Contents"));
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => page.doc.context.lookup(ref))
      : contents
        ? [contents]
        : [];
  const hashes = [];
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream))
      throw new PageError("OUTPUT_INVALID");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array(stream.getContents()),
    );
    hashes.push(
      Array.from(new Uint8Array(digest))
        .map((n) => n.toString(16).padStart(2, "0"))
        .join(""),
    );
  }
  return JSON.stringify({
    streams: hashes,
    media: page.getMediaBox(),
    crop: page.getCropBox(),
    rotation: normalizeRotation(rotation),
  });
}

export type PageOutputBytes = Readonly<{
  bytes: Uint8Array;
  pageCount: number;
}>;

/** Internal primitive shared by the single-output and Split workers. */
export async function loadPageSource(
  input: PageInput,
  plan: PagePlan,
  limits: PageLimits,
  cancelled: () => void,
): Promise<PDFDocument> {
  validatePageInput(input, limits);
  validatePagePlan(plan);
  if (input.id !== plan.sessionId) throw new PageError("INVALID_PLAN");
  cancelled();
  const bytes = await readPageInput(input, limits);
  cancelled();
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, loadOptions);
  } catch (error) {
    throw new PageError(
      error instanceof EncryptedPDFError ||
        (error instanceof Error && error.message === encryptedMessage)
        ? "ENCRYPTED_PDF"
        : "INVALID_PDF",
    );
  }
  if (source.getPageCount() > limits.maxPages)
    throw new PageError("PAGE_LIMIT");
  if (source.getPageCount() !== plan.sourcePageCount)
    throw new PageError("INVALID_PLAN");
  return source;
}

/** Internal primitive shared by the single-output and Split workers. */
export async function createPageOutputBytes(
  source: PDFDocument,
  plan: PagePlan,
  limits: PageLimits,
  cancelled: () => void,
  onValidating?: () => void,
): Promise<PageOutputBytes> {
  validatePagePlan(plan);
  if (source.getPageCount() !== plan.sourcePageCount)
    throw new PageError("INVALID_PLAN");
  cancelled();
  const destination = await PDFDocument.create({ updateMetadata: false });
  const copied = await destination.copyPages(
    source,
    plan.pages.map(({ sourcePageNumber }) => sourcePageNumber - 1),
  );
  const expected = [];
  for (let index = 0; index < copied.length; index++) {
    cancelled();
    const reference = plan.pages[index];
    const original = source.getPage(reference.sourcePageNumber - 1);
    const baseRotation = original.getRotation().angle;
    if (!Number.isInteger(baseRotation) || baseRotation % 90 !== 0)
      throw new PageError("INVALID_PDF");
    const rotation = normalizeRotation(baseRotation + reference.rotationDelta);
    expected.push(await signature(original, rotation));
    copied[index].setRotation(degrees(rotation));
    destination.addPage(copied[index]);
  }
  onValidating?.();
  const output = await destination.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
    objectsPerTick: 20,
  });
  cancelled();
  if (output.length > limits.maxOutputBytes)
    throw new PageError("OUTPUT_LIMIT");
  try {
    const reopened = await PDFDocument.load(output, loadOptions);
    if (reopened.getPageCount() !== expected.length)
      throw new PageError("OUTPUT_INVALID");
    for (let index = 0; index < expected.length; index++) {
      cancelled();
      if ((await signature(reopened.getPage(index))) !== expected[index])
        throw new PageError("OUTPUT_INVALID");
    }
  } catch (error) {
    if (error instanceof PageError && error.code === "CANCELLED") throw error;
    throw new PageError("OUTPUT_INVALID");
  }
  cancelled();
  return { bytes: new Uint8Array(output), pageCount: copied.length };
}

export async function transformPages(
  input: PageInput,
  plan: PagePlan,
  limits: PageLimits,
  options: PageOperationOptions = {},
): Promise<PageResult> {
  const cancelled = () => {
    if (options.signal?.aborted) throw new PageError("CANCELLED");
  };
  cancelled();
  try {
    options.onPhase?.("reading");
    const source = await loadPageSource(input, plan, limits, cancelled);
    options.onPhase?.("transforming");
    const output = await createPageOutputBytes(
      source,
      plan,
      limits,
      cancelled,
      () => options.onPhase?.("validating"),
    );
    return {
      blob: new Blob([new Uint8Array(output.bytes).buffer], {
        type: "application/pdf",
      }),
      pageCount: output.pageCount,
    };
  } catch (error) {
    if (error instanceof PageError) throw error;
    throw new PageError("OPERATION_FAILED");
  }
}
