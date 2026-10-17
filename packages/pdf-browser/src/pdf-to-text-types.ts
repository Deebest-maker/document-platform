import type { PageErrorCode } from "./page-errors";

export interface PdfToTextLimits {
  readonly maxCharacters: number;
  readonly maxBytes: number;
  readonly maxPreviewCharacters: number;
}

export type PdfToTextPhase = "extracting" | "validating";

export interface PdfToTextOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: {
    readonly phase: PdfToTextPhase;
    readonly current: number;
    readonly total: number;
  }) => void;
}

export interface PdfToTextPageOutcome {
  readonly sourcePageNumber: number;
  readonly characters: number;
  readonly bytes: number;
  readonly meaningful: boolean;
}

export interface PdfToTextResult {
  readonly kind: "text" | "no-text";
  readonly text: string;
  readonly characters: number;
  readonly bytes: number;
  readonly totalPages: number;
  readonly pagesWithText: number;
  readonly pagesWithoutText: readonly number[];
  readonly pages: readonly PdfToTextPageOutcome[];
}

export type PdfToTextErrorCode = PageErrorCode;
