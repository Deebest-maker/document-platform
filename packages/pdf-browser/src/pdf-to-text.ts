import { PageError } from "./page-errors";
import { validatePagePlan, type PagePlan } from "./page-model";
import type { PreviewDocument } from "./preview/types";
import type {
  PdfToTextLimits,
  PdfToTextOptions,
  PdfToTextPageOutcome,
  PdfToTextResult,
} from "./pdf-to-text-types";

export const PAGE_SEPARATOR = "\n\n";

export function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function isMeaningfulText(input: string): boolean {
  // Any non-whitespace Unicode code point counts.
  return /\S/u.test(input);
}

function safeLimits(limits: PdfToTextLimits) {
  if (
    !limits ||
    [limits.maxCharacters, limits.maxBytes, limits.maxPreviewCharacters].some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    )
  )
    throw new PageError("OUTPUT_LIMIT");
}

export async function extractPdfText(
  preview: PreviewDocument,
  plan: PagePlan,
  limits: PdfToTextLimits,
  options: PdfToTextOptions = {},
): Promise<PdfToTextResult> {
  const cancelled = () => {
    if (options.signal?.aborted) throw new PageError("CANCELLED");
  };
  try {
    safeLimits(limits);
    validatePagePlan(plan);
    if (preview.sessionId !== plan.sessionId)
      throw new PageError("INVALID_PLAN");
    const extractText = preview.extractText?.bind(preview);
    if (!extractText) throw new PageError("OPERATION_FAILED");
    const encoder = new TextEncoder();
    const outcomes: PdfToTextPageOutcome[] = [];
    const chunks: string[] = [];
    const pagesWithoutText: number[] = [];
    let runningCharacters = 0;
    let runningBytes = 0;
    for (const [index, page] of plan.pages.entries()) {
      cancelled();
      options.onProgress?.({
        phase: "extracting",
        current: index + 1,
        total: plan.pages.length,
      });
      // getTextContent() cannot be interrupted mid-call. ADR-019 documents this.
      const chunk = await extractText(page.sourcePageNumber, {
        signal: options.signal,
      });
      cancelled();
      const normalized = normalizeLineEndings(chunk.text ?? "");
      const chars = normalized.length;
      const bytes = encoder.encode(normalized).byteLength;
      if (runningCharacters + chars > limits.maxCharacters)
        throw new PageError("OUTPUT_LIMIT");
      if (runningBytes + bytes > limits.maxBytes)
        throw new PageError("OUTPUT_LIMIT");
      runningCharacters += chars;
      runningBytes += bytes;
      const meaningful = isMeaningfulText(normalized);
      if (!meaningful) pagesWithoutText.push(page.sourcePageNumber);
      outcomes.push({
        sourcePageNumber: page.sourcePageNumber,
        characters: chars,
        bytes,
        meaningful,
      });
      chunks.push(normalized);
    }
    cancelled();
    options.onProgress?.({
      phase: "validating",
      current: plan.pages.length,
      total: plan.pages.length,
    });
    const pagesWithText = outcomes.filter((entry) => entry.meaningful).length;
    if (pagesWithText === 0)
      return Object.freeze({
        kind: "no-text" as const,
        text: "",
        characters: 0,
        bytes: 0,
        totalPages: plan.pages.length,
        pagesWithText: 0,
        pagesWithoutText: Object.freeze(
          outcomes.map((entry) => entry.sourcePageNumber),
        ),
        pages: Object.freeze(outcomes),
      });
    const assembled = chunks.join(PAGE_SEPARATOR);
    const assembledCharacters = assembled.length;
    const assembledBytes = encoder.encode(assembled).byteLength;
    if (assembledCharacters > limits.maxCharacters)
      throw new PageError("OUTPUT_LIMIT");
    if (assembledBytes > limits.maxBytes) throw new PageError("OUTPUT_LIMIT");
    return Object.freeze({
      kind: "text" as const,
      text: assembled,
      characters: assembledCharacters,
      bytes: assembledBytes,
      totalPages: plan.pages.length,
      pagesWithText,
      pagesWithoutText: Object.freeze(pagesWithoutText),
      pages: Object.freeze(outcomes),
    });
  } catch (error) {
    if (error instanceof PageError) throw error;
    throw new PageError("OPERATION_FAILED");
  }
}

export type {
  PdfToTextLimits,
  PdfToTextOptions,
  PdfToTextPageOutcome,
  PdfToTextPhase,
  PdfToTextResult,
} from "./pdf-to-text-types";
