import { createPagePlan } from "@document-platform/pdf-browser/page-model";
import {
  PageError,
  pageLimits,
  type PageInput,
  type PageLimits,
} from "@document-platform/pdf-browser/pages";
import type {
  PdfToTextLimits,
  PdfToTextPhase,
  PdfToTextResult,
} from "@document-platform/pdf-browser/pdf-to-text";
import type { PreviewDocument } from "@document-platform/pdf-browser/preview";

export type PdfTextWorkflowError =
  PageError["code"] | "ENGINE_LOAD_FAILED" | "CLIPBOARD_FAILED";

export const pdfTextErrorCopy: Record<PdfTextWorkflowError, string> = {
  INVALID_PLAN: "This PDF could not be analysed. Choose another file.",
  INPUT_LIMIT:
    "This PDF exceeds the current single-file size limit. Choose a smaller PDF.",
  INVALID_PDF: "This file could not be opened as a PDF. Choose another file.",
  ENCRYPTED_PDF:
    "This PDF is password-protected. Unlock it before extracting text.",
  PAGE_LIMIT:
    "This PDF exceeds the current page limit for text extraction. Choose a shorter PDF.",
  OUTPUT_LIMIT:
    "This PDF produces more text than the current limit allows. Try a shorter document.",
  OUTPUT_INVALID:
    "The extracted text could not be validated. No text was published.",
  OPERATION_FAILED:
    "The text could not be extracted. Try another PDF or try again later.",
  PREVIEW_FAILED:
    "The PDF could not be opened for text extraction. Try another file.",
  RENDER_FAILED:
    "The text could not be extracted. Try another PDF or try again later.",
  CANCELLED: "Extraction cancelled. Choose a PDF to try again.",
  WORKER_UNAVAILABLE:
    "This browser could not start local text extraction. Try an up-to-date browser.",
  ENGINE_LOAD_FAILED:
    "The local PDF engine could not load. Check your connection and try again.",
  CLIPBOARD_FAILED:
    "The clipboard is unavailable in this browser. Use Download instead.",
};

export interface PdfTextSnapshot {
  readonly state:
    "idle" | "loading" | "extracting" | "ready" | "no-text" | "error";
  readonly fileName?: string;
  readonly totalPages?: number;
  readonly pagesWithText?: number;
  readonly pagesWithoutText?: readonly number[];
  readonly previewText?: string;
  readonly previewTruncated: boolean;
  readonly result?: {
    readonly characters: number;
    readonly bytes: number;
    readonly url: string;
  };
  readonly progress?: {
    readonly phase: PdfToTextPhase;
    readonly current: number;
    readonly total: number;
  };
  readonly copyState: "idle" | "copying" | "copied" | "failed";
  readonly error?: PdfTextWorkflowError;
  readonly announcement: string;
}

interface Dependencies {
  openPreview: (
    input: PageInput,
    limits: PageLimits,
    options: { signal: AbortSignal },
  ) => Promise<PreviewDocument>;
  extractText: (
    preview: PreviewDocument,
    plan: ReturnType<typeof createPagePlan>,
    limits: PdfToTextLimits,
    options: {
      signal: AbortSignal;
      onProgress: (progress: {
        phase: PdfToTextPhase;
        current: number;
        total: number;
      }) => void;
    },
  ) => Promise<PdfToTextResult>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  writeClipboard: (text: string) => Promise<void>;
  id: () => string;
}

const defaults: Dependencies = {
  openPreview: async (input, limits, options) =>
    (await import("@document-platform/pdf-browser/preview")).openPreview(
      input,
      limits,
      options,
    ),
  extractText: async (preview, plan, limits, options) =>
    (await import("@document-platform/pdf-browser/pdf-to-text")).extractPdfText(
      preview,
      plan,
      limits,
      options,
    ),
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  writeClipboard: async (text) => {
    if (!navigator.clipboard?.writeText) throw new Error("unavailable");
    await navigator.clipboard.writeText(text);
  },
  id: () => crypto.randomUUID(),
};

const empty = (): PdfTextSnapshot => ({
  state: "idle",
  previewTruncated: false,
  copyState: "idle",
  announcement: "",
});

function safeFileName(name: string | undefined) {
  if (!name) return undefined;
  return (
    (name.split(/[\\/]/).pop() ?? "")
      .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "")
      .slice(0, 160) || undefined
  );
}

function buildPreview(text: string, cap: number) {
  if (text.length <= cap) return { previewText: text, previewTruncated: false };
  // Prefer a boundary at a line break for a stable, readable preview.
  const sliceEnd = text.lastIndexOf("\n", cap) + 1 || cap;
  return {
    previewText: text.slice(0, sliceEnd),
    previewTruncated: true,
  };
}

export class PdfTextSession {
  private snapshot: PdfTextSnapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort?: AbortController;
  private preview?: PreviewDocument;
  private fullText = "";
  private readonly dependencies: Dependencies;

  constructor(
    readonly limits: PdfToTextLimits,
    readonly pageLimits_: PageLimits = pageLimits,
    dependencies: Partial<Dependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(next: PdfTextSnapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  private releaseResult() {
    if (this.snapshot.result)
      this.dependencies.revokeUrl(this.snapshot.result.url);
  }

  private async releasePreview() {
    const preview = this.preview;
    this.preview = undefined;
    if (preview) {
      try {
        await preview.destroy();
      } catch {
        /* release only. */
      }
    }
  }

  private abandon() {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
  }

  async setSource(file: File) {
    this.abandon();
    this.releaseResult();
    this.fullText = "";
    const token = ++this.generation;
    const controller = new AbortController();
    this.abort = controller;
    const fileName = safeFileName(file.name);
    this.publish({
      ...empty(),
      state: "loading",
      fileName,
      announcement: "Opening the PDF.",
    });
    await this.releasePreview();
    if (token !== this.generation) return;
    let preview: PreviewDocument;
    try {
      preview = await this.dependencies.openPreview(
        { id: this.dependencies.id(), blob: file },
        this.pageLimits_,
        { signal: controller.signal },
      );
    } catch (caught) {
      if (token !== this.generation) return;
      this.abort = undefined;
      const code =
        caught instanceof PageError ? caught.code : "OPERATION_FAILED";
      this.publish({
        ...empty(),
        state: "error",
        fileName,
        error: code,
        announcement: pdfTextErrorCopy[code],
      });
      return;
    }
    if (token !== this.generation) {
      try {
        await preview.destroy();
      } catch {
        /* unused preview from a stale call. */
      }
      return;
    }
    this.preview = preview;
    const plan = createPagePlan(preview.pageCount, preview.sessionId);
    this.publish({
      ...empty(),
      state: "extracting",
      fileName,
      totalPages: preview.pageCount,
      progress: { phase: "extracting", current: 0, total: preview.pageCount },
      announcement: `Extracting text from ${preview.pageCount} ${preview.pageCount === 1 ? "page" : "pages"}.`,
    });
    let result: PdfToTextResult;
    try {
      result = await this.dependencies.extractText(preview, plan, this.limits, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (token !== this.generation) return;
          if (progress.phase === "extracting")
            this.publish({
              ...this.snapshot,
              progress,
              announcement: `Extracting page ${progress.current} of ${progress.total}.`,
            });
          else
            this.publish({
              ...this.snapshot,
              progress,
              announcement: "Validating extracted text.",
            });
        },
      });
    } catch (caught) {
      if (token !== this.generation) return;
      this.abort = undefined;
      await this.releasePreview();
      const code =
        caught instanceof PageError ? caught.code : "OPERATION_FAILED";
      this.publish({
        ...empty(),
        state: "error",
        fileName,
        error: code,
        announcement: pdfTextErrorCopy[code],
      });
      return;
    }
    if (token !== this.generation) {
      await this.releasePreview();
      return;
    }
    this.abort = undefined;
    await this.releasePreview();
    if (result.kind === "no-text") {
      this.publish({
        ...empty(),
        state: "no-text",
        fileName,
        totalPages: result.totalPages,
        pagesWithText: 0,
        pagesWithoutText: result.pagesWithoutText,
        announcement:
          "No meaningful text layer was found. This PDF may be scanned or image-based and may require OCR.",
      });
      return;
    }
    this.fullText = result.text;
    const { previewText, previewTruncated } = buildPreview(
      result.text,
      this.limits.maxPreviewCharacters,
    );
    const blob = new Blob([result.text], {
      type: "text/plain;charset=utf-8",
    });
    const url = this.dependencies.createUrl(blob);
    this.publish({
      ...empty(),
      state: "ready",
      fileName,
      totalPages: result.totalPages,
      pagesWithText: result.pagesWithText,
      pagesWithoutText: result.pagesWithoutText,
      previewText,
      previewTruncated,
      result: {
        characters: result.characters,
        bytes: result.bytes,
        url,
      },
      announcement:
        result.pagesWithoutText.length === 0
          ? `Extracted text from all ${result.totalPages} ${result.totalPages === 1 ? "page" : "pages"}.`
          : `Extracted text from ${result.pagesWithText} of ${result.totalPages} pages. ${result.pagesWithoutText.length} ${result.pagesWithoutText.length === 1 ? "page" : "pages"} contained no meaningful text.`,
    });
  }

  cancel() {
    if (!["loading", "extracting"].includes(this.snapshot.state)) return;
    this.abandon();
    void this.releasePreview();
    this.publish({
      ...empty(),
      state: "idle",
      fileName: this.snapshot.fileName,
      announcement: "Extraction cancelled. Choose a PDF to try again.",
    });
  }

  async copy() {
    if (this.snapshot.state !== "ready" || !this.fullText) return;
    this.publish({
      ...this.snapshot,
      copyState: "copying",
      announcement: "Copying extracted text.",
    });
    try {
      await this.dependencies.writeClipboard(this.fullText);
      this.publish({
        ...this.snapshot,
        copyState: "copied",
        announcement: "Extracted text copied.",
      });
    } catch {
      this.publish({
        ...this.snapshot,
        copyState: "failed",
        error: "CLIPBOARD_FAILED",
        announcement: pdfTextErrorCopy.CLIPBOARD_FAILED,
      });
    }
  }

  acknowledgeCopy() {
    if (this.snapshot.copyState === "copied")
      this.publish({ ...this.snapshot, copyState: "idle", announcement: "" });
  }

  reset = () => {
    this.abandon();
    this.releaseResult();
    this.fullText = "";
    void this.releasePreview();
    this.publish({
      ...empty(),
      announcement: "Session cleared. Choose a PDF to extract text again.",
    });
  };

  dispose = () => {
    this.reset();
    this.snapshot = empty();
  };

  // Only used by tests and the Download button to produce the exact result bytes.
  getFullText = () => this.fullText;
}

export const extractedTextFilename = "extracted-text.txt";

export function formatCharacterCount(count: number) {
  if (count < 1_000) return `${count} characters`;
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}K characters`;
  return `${(count / 1_000_000).toFixed(2)}M characters`;
}

export function formatByteCount(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
