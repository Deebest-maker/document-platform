import { PageError, pageLimits } from "@document-platform/pdf-browser/pages";
import type {
  MetadataPhase,
  MetadataRemovalLimits,
  MetadataRemovalResult,
  StandardInfoKey,
} from "@document-platform/pdf-browser/metadata-removal";

export type RemoveMetadataWorkflowError =
  PageError["code"] | "ENGINE_LOAD_FAILED";

export const removeMetadataErrorCopy: Record<
  RemoveMetadataWorkflowError,
  string
> = {
  INVALID_PLAN: "This PDF could not be analysed. Choose another file.",
  INPUT_LIMIT:
    "This PDF exceeds the current single-file size limit. Choose a smaller PDF.",
  INVALID_PDF: "This file could not be opened as a PDF. Choose another file.",
  ENCRYPTED_PDF:
    "This PDF is password-protected. Unlock it before removing metadata.",
  PAGE_LIMIT:
    "This PDF exceeds the current page limit for metadata removal. Choose a shorter PDF.",
  OUTPUT_LIMIT:
    "The cleaned PDF exceeds the current size limit. Try a smaller PDF.",
  OUTPUT_INVALID:
    "The cleaned PDF could not be validated. No file was published.",
  OPERATION_FAILED:
    "Metadata could not be removed. Try another PDF or try again later.",
  PREVIEW_FAILED:
    "The PDF could not be opened for metadata removal. Try another file.",
  RENDER_FAILED:
    "Metadata could not be removed. Try another PDF or try again later.",
  CANCELLED: "Metadata removal cancelled. Choose a PDF to try again.",
  WORKER_UNAVAILABLE:
    "This browser could not start local metadata removal. Try an up-to-date browser.",
  ENGINE_LOAD_FAILED:
    "The local PDF engine could not load. Check your connection and try again.",
};

export interface RemoveMetadataSnapshot {
  readonly state: "idle" | "loading" | "processing" | "ready" | "error";
  readonly fileName?: string;
  readonly inputBytes?: number;
  readonly outputBytes?: number;
  readonly pageCount?: number;
  readonly before?: {
    readonly standardInfoCount: number;
    readonly customInfoCount: number;
    readonly xmpStreamPresent: boolean;
    readonly trailerIdPresent: boolean;
  };
  readonly after?: {
    readonly standardInfoCount: number;
    readonly customInfoCount: number;
    readonly xmpStreamPresent: boolean;
    readonly trailerIdPresent: boolean;
  };
  readonly removed?: {
    readonly standardInfo: readonly StandardInfoKey[];
    readonly customInfo: readonly string[];
    readonly xmpStream: boolean;
    readonly trailerId: boolean;
  };
  readonly trailerIdControllable?: boolean;
  readonly pagesPreserved?: boolean;
  readonly result?: {
    readonly url: string;
    readonly fileName: string;
    readonly bytes: number;
  };
  readonly progress?: {
    readonly phase: MetadataPhase;
  };
  readonly error?: RemoveMetadataWorkflowError;
  readonly announcement: string;
}

type RuntimeInput = { readonly id: string; readonly blob: Blob };

interface Dependencies {
  readonly removeMetadata: (
    input: RuntimeInput,
    limits: MetadataRemovalLimits,
    options?: {
      readonly signal?: AbortSignal;
      readonly onPhase?: (phase: MetadataPhase) => void;
    },
  ) => Promise<MetadataRemovalResult>;
  readonly loadEngine?: () => Promise<void>;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly createSessionId?: () => string;
  readonly limits?: MetadataRemovalLimits;
}

const DEFAULT_LIMITS: MetadataRemovalLimits = Object.freeze({
  maxInputBytes: pageLimits.maxInputBytes,
  maxPages: pageLimits.maxPages,
  maxOutputBytes: pageLimits.maxOutputBytes,
});

class EngineLoadFailed extends Error {
  constructor() {
    super("engine-load-failed");
    this.name = "EngineLoadFailed";
  }
}

// The output filename is fixed. The source filename never flows into the
// result URL, the download attribute, the Blob mime type, or any announcement.
// This is a project-wide output-naming rule (same as /pdf-to-text's
// extracted-text.txt and /jpg-to-pdf's images-to-pdf.pdf).
export const metadataRemovedFilename = "metadata-removed.pdf";

function describeOutcome(result: MetadataRemovalResult): string {
  const parts: string[] = [];
  if (result.removed.standardInfo.length > 0)
    parts.push(
      `${result.removed.standardInfo.length} standard metadata field${
        result.removed.standardInfo.length === 1 ? "" : "s"
      }`,
    );
  if (result.removed.customInfo.length > 0)
    parts.push(
      `${result.removed.customInfo.length} custom metadata field${
        result.removed.customInfo.length === 1 ? "" : "s"
      }`,
    );
  if (result.removed.xmpStream) parts.push("the XMP metadata stream");
  if (result.removed.trailerId) parts.push("the trailer identifier");
  if (parts.length === 0) return "No supported metadata was present.";
  const joined =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? `${parts[0]} and ${parts[1]}`
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Removed ${joined}.`;
}

export class RemoveMetadataSession {
  private snapshot: RemoveMetadataSnapshot = {
    state: "idle",
    announcement: "",
  };
  private listeners = new Set<(snapshot: RemoveMetadataSnapshot) => void>();
  private controller?: AbortController;
  private generation = 0;
  private currentUrl?: string;

  constructor(private readonly deps: Dependencies) {}

  getSnapshot(): RemoveMetadataSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: RemoveMetadataSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async run(file: File): Promise<void> {
    this.cancel();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.revokeCurrentUrl();
    this.set({
      state: "loading",
      fileName: file.name,
      inputBytes: file.size,
      announcement: `Preparing ${file.name} for metadata removal.`,
    });

    try {
      if (this.deps.loadEngine) {
        try {
          await this.deps.loadEngine();
        } catch {
          throw new EngineLoadFailed();
        }
      }
      if (generation !== this.generation) return;
      const input: RuntimeInput = {
        id: this.deps.createSessionId?.() ?? `remove-metadata-${generation}`,
        blob: file,
      };
      const limits = this.deps.limits ?? DEFAULT_LIMITS;
      this.set({
        state: "processing",
        fileName: file.name,
        inputBytes: file.size,
        progress: { phase: "reading" },
        announcement: `Reading ${file.name}.`,
      });
      const result = await this.deps.removeMetadata(input, limits, {
        signal: controller.signal,
        onPhase: (phase) => {
          if (generation !== this.generation) return;
          this.patch({
            progress: { phase },
            announcement:
              phase === "reading"
                ? "Reading the PDF."
                : phase === "removing"
                  ? "Removing supported metadata fields."
                  : phase === "validating"
                    ? "Saving the cleaned PDF."
                    : "Verifying the cleaned PDF.",
          });
        },
      });
      if (generation !== this.generation) return;
      const createUrl =
        this.deps.createObjectUrl ??
        ((blob: Blob) => URL.createObjectURL(blob));
      const url = createUrl(result.blob);
      this.currentUrl = url;
      // Fixed output filename — see metadataRemovedFilename above.
      const outName = metadataRemovedFilename;
      this.set({
        state: "ready",
        fileName: file.name,
        inputBytes: file.size,
        outputBytes: result.bytes,
        pageCount: result.pageCount,
        before: {
          standardInfoCount: Object.values(
            result.before.standardInfoPresent,
          ).filter(Boolean).length,
          customInfoCount: result.before.customInfoKeys.length,
          xmpStreamPresent: result.before.xmpStreamPresent,
          trailerIdPresent: result.before.trailerIdPresent,
        },
        after: {
          standardInfoCount: Object.values(
            result.after.standardInfoPresent,
          ).filter(Boolean).length,
          customInfoCount: result.after.customInfoKeys.length,
          xmpStreamPresent: result.after.xmpStreamPresent,
          trailerIdPresent: result.after.trailerIdPresent,
        },
        removed: result.removed,
        trailerIdControllable: result.trailerIdControllable,
        pagesPreserved: result.pagesPreserved,
        result: { url, fileName: outName, bytes: result.bytes },
        announcement: describeOutcome(result),
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const code = this.classify(error);
      this.set({
        state: "error",
        fileName: file.name,
        inputBytes: file.size,
        error: code,
        announcement: removeMetadataErrorCopy[code] ?? "An error occurred.",
      });
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
  }

  reset(): void {
    this.cancel();
    this.generation += 1;
    this.revokeCurrentUrl();
    this.set({ state: "idle", announcement: "" });
  }

  dispose(): void {
    this.reset();
    this.listeners.clear();
  }

  private classify(error: unknown): RemoveMetadataWorkflowError {
    if (error instanceof EngineLoadFailed) return "ENGINE_LOAD_FAILED";
    if (error instanceof PageError) return error.code;
    return "OPERATION_FAILED";
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

  private set(next: RemoveMetadataSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }

  private patch(part: Partial<RemoveMetadataSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...part };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

export const __testing = {
  describeOutcome,
};
