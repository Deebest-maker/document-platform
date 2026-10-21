import {
  DEFAULT_COMPRESS_PROFILE,
  IMAGE_SKIP_CATEGORY,
  PageError,
  type CompressLimits,
  type CompressOptions,
  type CompressPhase,
  type CompressProfileId,
  type CompressResult,
  type CompressWarning,
  type ImageSkipCategory,
  type ImageSkipReason,
  type PageErrorCode,
} from "@document-platform/pdf-browser/compress";

export type CompressWorkflowError = PageErrorCode;

export const compressErrorCopy: Record<CompressWorkflowError, string> = {
  INVALID_PLAN: "This request could not be started. Choose the PDF again.",
  INPUT_LIMIT:
    "This PDF exceeds the current size limit for compression. Choose a smaller PDF.",
  INVALID_PDF: "This file could not be opened as a PDF. Choose another file.",
  ENCRYPTED_PDF:
    "This PDF is password-protected. Unlock it before compressing.",
  PAGE_LIMIT:
    "This PDF has more pages than the current limit for compression. Choose a shorter PDF.",
  OUTPUT_LIMIT:
    "The compressed PDF exceeds the current size limit. Choose a smaller PDF.",
  OUTPUT_INVALID:
    "The compressed PDF could not be validated, so no file was created. Your original is unchanged.",
  OPERATION_FAILED:
    "This PDF could not be compressed. It may be too large for this device's memory. Try a smaller PDF or another browser.",
  PREVIEW_FAILED: "This PDF could not be compressed. Try another file.",
  RENDER_FAILED: "This PDF could not be compressed. Try another file.",
  CANCELLED: "Compression cancelled.",
  WORKER_UNAVAILABLE:
    "This browser could not start local compression. Try an up-to-date browser.",
};

export const compressProfileCopy: Record<
  CompressProfileId,
  { label: string; summary: string; detail: string }
> = {
  light: {
    label: "Light",
    summary: "Best quality, smaller saving",
    detail:
      "Images above about 220 dpi are reduced to 220 dpi and saved at high JPEG quality.",
  },
  balanced: {
    label: "Balanced",
    summary: "Recommended for email and screens",
    detail:
      "Images above about 150 dpi are reduced to 150 dpi and saved at medium JPEG quality.",
  },
  strong: {
    label: "Strong",
    summary: "Smallest file, softer images",
    detail:
      "Images above about 110 dpi are reduced to 110 dpi and saved at lower JPEG quality. Fine detail in photos and scans may look softer.",
  },
};

export type UnchangedCounts = Readonly<Record<ImageSkipCategory, number>>;

export interface CompressOutcome {
  readonly kind: "reduced" | "no-reduction";
  readonly profile: CompressProfileId;
  readonly inputBytes: number;
  // Size of the compressed candidate (published only when `kind` is reduced).
  readonly outputBytes: number;
  // Whole percent saved; 0 when the file did not get smaller.
  readonly savedPercent: number;
  readonly pageCount: number;
  readonly imagesFound: number;
  readonly imagesOptimized: number;
  readonly unchanged: UnchangedCounts;
  readonly warnings: readonly CompressWarning[];
  readonly url?: string;
  readonly fileName?: string;
}

export interface CompressProgressView {
  readonly phase: CompressPhase;
  readonly done?: number;
  readonly total?: number;
}

export interface CompressSnapshot {
  readonly state: "idle" | "selected" | "processing" | "ready" | "error";
  readonly profile: CompressProfileId;
  readonly fileName?: string;
  readonly inputBytes?: number;
  readonly progress?: CompressProgressView;
  readonly outcome?: CompressOutcome;
  readonly error?: CompressWorkflowError;
  readonly announcement: string;
}

type Compress = (
  input: { readonly id: string; readonly blob: Blob },
  profile: CompressProfileId,
  limits: CompressLimits,
  options?: CompressOptions,
) => Promise<CompressResult>;

interface Dependencies {
  readonly compress: Compress;
  readonly limits: CompressLimits;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly createSessionId?: () => string;
}

// The output name is fixed. The source filename never reaches the download
// attribute, the Blob type or any announcement (project-wide naming rule).
export const compressedFilename = "compressed.pdf";

export function summarizeSkips(
  skipped: Readonly<Partial<Record<ImageSkipReason, number>>>,
): UnchangedCounts {
  const counts: Record<ImageSkipCategory, number> = {
    efficient: 0,
    protected: 0,
    limits: 0,
    unreadable: 0,
  };
  for (const [reason, count] of Object.entries(skipped))
    counts[IMAGE_SKIP_CATEGORY[reason as ImageSkipReason]] += count ?? 0;
  return counts;
}

export function savedPercent(inputBytes: number, outputBytes: number): number {
  if (inputBytes <= 0 || outputBytes >= inputBytes) return 0;
  // Never round a real saving up to a claim of 100%.
  return Math.min(99, Math.round((1 - outputBytes / inputBytes) * 100));
}

export function describeOutcome(outcome: CompressOutcome): string {
  if (outcome.kind === "no-reduction")
    return "This PDF could not be made meaningfully smaller. No file was created.";
  return `Compressed PDF ready, ${outcome.savedPercent} percent smaller.`;
}

export class CompressSession {
  private snapshot: CompressSnapshot = {
    state: "idle",
    profile: DEFAULT_COMPRESS_PROFILE,
    announcement: "",
  };
  private listeners = new Set<(snapshot: CompressSnapshot) => void>();
  private controller?: AbortController;
  private generation = 0;
  private currentUrl?: string;
  private file?: File;

  constructor(private readonly deps: Dependencies) {}

  getSnapshot(): CompressSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: CompressSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Chooses a PDF. Nothing is read or processed until `start`.
  choose(file: File): void {
    this.abort();
    this.revokeCurrentUrl();
    this.generation += 1;
    const { maxInputBytes } = this.deps.limits;
    if (file.size < 1 || file.size > maxInputBytes) {
      this.file = undefined;
      this.set({
        state: "error",
        profile: this.snapshot.profile,
        fileName: file.name,
        inputBytes: file.size,
        error: "INPUT_LIMIT",
        announcement: compressErrorCopy.INPUT_LIMIT,
      });
      return;
    }
    this.file = file;
    this.set({
      state: "selected",
      profile: this.snapshot.profile,
      fileName: file.name,
      inputBytes: file.size,
      announcement: "PDF selected. Choose a strength and compress.",
    });
  }

  setProfile(profile: CompressProfileId): void {
    if (this.snapshot.state === "processing") return;
    this.patch({ profile });
  }

  async start(): Promise<void> {
    const file = this.file;
    if (!file || this.snapshot.state === "processing") return;
    this.abort();
    this.revokeCurrentUrl();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const profile = this.snapshot.profile;
    this.set({
      state: "processing",
      profile,
      fileName: file.name,
      inputBytes: file.size,
      progress: { phase: "reading" },
      announcement: "Compressing on your device.",
    });
    try {
      const result = await this.deps.compress(
        {
          id: this.deps.createSessionId?.() ?? `compress-${generation}`,
          blob: file,
        },
        profile,
        this.deps.limits,
        {
          signal: controller.signal,
          onPhase: (phase) => {
            if (generation !== this.generation) return;
            this.patch({
              progress: { phase },
              announcement: phaseAnnouncement[phase],
            });
          },
          onProgress: (progress) => {
            if (generation !== this.generation) return;
            this.patch({
              progress: {
                phase: progress.phase,
                done: progress.done,
                total: progress.total,
              },
            });
          },
        },
      );
      if (generation !== this.generation) return;
      const reduced = result.outcome === "reduced" && result.blob;
      let url: string | undefined;
      if (reduced) {
        const create =
          this.deps.createObjectUrl ??
          ((blob: Blob) => URL.createObjectURL(blob));
        url = create(result.blob!);
        this.currentUrl = url;
      }
      const outcome: CompressOutcome = {
        kind: reduced ? "reduced" : "no-reduction",
        profile: result.profile,
        inputBytes: result.inputBytes,
        outputBytes: result.outputBytes,
        savedPercent: reduced
          ? savedPercent(result.inputBytes, result.outputBytes)
          : 0,
        pageCount: result.pageCount,
        imagesFound: result.images.found,
        imagesOptimized: result.images.optimized,
        unchanged: summarizeSkips(result.images.skipped),
        warnings: result.warnings,
        url,
        fileName: reduced ? compressedFilename : undefined,
      };
      this.set({
        state: "ready",
        profile,
        fileName: file.name,
        inputBytes: file.size,
        outcome,
        announcement: describeOutcome(outcome),
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const code: CompressWorkflowError =
        error instanceof PageError ? error.code : "OPERATION_FAILED";
      if (code === "CANCELLED") {
        // Keep the file so another strength can be tried straight away.
        this.set({
          state: "selected",
          profile,
          fileName: file.name,
          inputBytes: file.size,
          announcement: compressErrorCopy.CANCELLED,
        });
        return;
      }
      this.set({
        state: "error",
        profile,
        fileName: file.name,
        inputBytes: file.size,
        error: code,
        announcement: compressErrorCopy[code] ?? "An error occurred.",
      });
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  cancel(): void {
    this.controller?.abort();
  }

  // Back to strength selection with the same PDF, releasing the old result.
  tryAnotherStrength(): void {
    if (!this.file) return;
    this.abort();
    this.revokeCurrentUrl();
    this.generation += 1;
    this.set({
      state: "selected",
      profile: this.snapshot.profile,
      fileName: this.file.name,
      inputBytes: this.file.size,
      announcement: "Choose a strength and compress again.",
    });
  }

  reset(): void {
    this.abort();
    this.generation += 1;
    this.revokeCurrentUrl();
    this.file = undefined;
    this.set({
      state: "idle",
      profile: DEFAULT_COMPRESS_PROFILE,
      announcement: "",
    });
  }

  dispose(): void {
    this.reset();
    this.listeners.clear();
  }

  private abort(): void {
    this.controller?.abort();
    this.controller = undefined;
  }

  private revokeCurrentUrl(): void {
    if (!this.currentUrl) return;
    const revoke =
      this.deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
    try {
      revoke(this.currentUrl);
    } catch {
      // non-fatal
    }
    this.currentUrl = undefined;
  }

  private set(next: CompressSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }

  private patch(part: Partial<CompressSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...part };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

const phaseAnnouncement: Record<CompressPhase, string> = {
  reading: "Reading the PDF.",
  images: "Optimizing images.",
  structure: "Rewriting document data.",
  saving: "Saving the compressed PDF.",
  verifying: "Checking the compressed PDF.",
};

export const __testing = { phaseAnnouncement };
