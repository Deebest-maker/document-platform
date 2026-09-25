import { validatePdfCandidate } from "@document-platform/pdf-browser/validation";
import type {
  MergeLimits,
  MergeOptions,
  MergePhase,
  MergeResult,
  PdfErrorCode,
  PdfInput,
} from "@document-platform/pdf-browser/types";

export type WorkflowError = PdfErrorCode | "ENGINE_LOAD_FAILED";
export const errorCopy: Record<WorkflowError, string> = {
  INPUT_COUNT: "Choose at least two PDFs to merge.",
  EMPTY_INPUT: "This file is empty. Remove it and choose a PDF with pages.",
  UNSUPPORTED_TYPE:
    "This file is not a supported PDF. Remove it and choose a PDF.",
  INPUT_LIMIT:
    "The selection exceeds the current file or size limits. Remove files and try again.",
  UNREADABLE_FILE:
    "This file could not be read. Remove it and choose it again.",
  ENCRYPTED_PDF:
    "Password-protected PDFs are not supported. Remove this file and choose an unencrypted copy.",
  INVALID_PDF:
    "This PDF is damaged or unsupported. Remove it and choose another copy.",
  PAGE_LIMIT:
    "The selection exceeds the page limit. Remove files and try again.",
  OUTPUT_LIMIT:
    "The merged PDF exceeds the output size limit. Try fewer or smaller files.",
  OUTPUT_INVALID:
    "The result could not be validated. No download was created. Try different files.",
  MERGE_FAILED:
    "The merge could not finish. Try again with fewer or smaller files.",
  WORKER_UNAVAILABLE:
    "This browser could not start local processing. Try an up-to-date browser.",
  CANCELLED: "Merge cancelled. Your selected files are still here.",
  ENGINE_LOAD_FAILED:
    "The local PDF engine could not load. Check your connection and try again.",
};
export interface Selection {
  id: string;
  file: File;
  error?: WorkflowError;
}
interface Result extends MergeResult {
  url: string;
}
export interface Snapshot {
  state: "idle" | "selected" | "processing" | "result" | "error";
  rows: readonly Selection[];
  phase?: MergePhase;
  error?: WorkflowError;
  result?: Result;
  announcement: string;
}
type Engine = (
  inputs: readonly PdfInput[],
  limits: MergeLimits,
  options?: MergeOptions,
) => Promise<MergeResult>;
interface Dependencies {
  load: () => Promise<{ mergePdfs: Engine }>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  id: () => string;
}
const defaults: Dependencies = {
  load: () => import("@document-platform/pdf-browser"),
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  id: () => crypto.randomUUID(),
};
const empty = (): Snapshot => ({ state: "idle", rows: [], announcement: "" });

// One instance per mounted route. It is never a global/persisted store.
export class MergeSession {
  private snapshot: Snapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort?: AbortController;
  private readonly dependencies: Dependencies;
  constructor(
    readonly limits: MergeLimits,
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
  private publish(next: Snapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
  private releaseResult() {
    if (this.snapshot.result)
      this.dependencies.revokeUrl(this.snapshot.result.url);
  }
  private abandon() {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    this.releaseResult();
  }
  private selection(
    rows: readonly Selection[],
    announcement: string,
    error?: WorkflowError,
  ) {
    const size = rows.reduce((sum, row) => sum + row.file.size, 0);
    const issue =
      error ??
      rows.find((row) => row.error)?.error ??
      (size > this.limits.maxTotalBytes ? "INPUT_LIMIT" : undefined);
    this.publish({
      state: issue ? "error" : rows.length ? "selected" : "idle",
      rows,
      error: issue,
      announcement,
    });
  }
  add(files: readonly File[]) {
    if (
      this.snapshot.state === "processing" ||
      this.snapshot.state === "result" ||
      files.length === 0
    )
      return;
    if (files.length + this.snapshot.rows.length > this.limits.maxFiles) {
      this.selection(
        this.snapshot.rows,
        "No files added. File count limit exceeded.",
        "INPUT_LIMIT",
      );
      return;
    }
    const rows = files.map((file) => ({
      id: this.dependencies.id(),
      file,
      error: validatePdfCandidate(file, this.limits),
    }));
    this.selection(
      [...this.snapshot.rows, ...rows],
      `${files.length} ${files.length === 1 ? "file" : "files"} added.`,
    );
  }
  remove(id: string) {
    if (["processing", "result"].includes(this.snapshot.state)) return;
    this.selection(
      this.snapshot.rows.filter((row) => row.id !== id),
      "File removed.",
    );
  }
  move(id: string, offset: -1 | 1) {
    if (["processing", "result"].includes(this.snapshot.state)) return;
    const rows = [...this.snapshot.rows];
    const from = rows.findIndex((row) => row.id === id),
      to = from + offset;
    if (from < 0 || to < 0 || to >= rows.length) return;
    [rows[from], rows[to]] = [rows[to], rows[from]];
    this.selection(rows, `File moved to position ${to + 1} of ${rows.length}.`);
  }
  canMerge() {
    return (
      ["selected", "error"].includes(this.snapshot.state) &&
      this.snapshot.rows.length >= 2 &&
      !this.snapshot.rows.some((row) => row.error) &&
      this.snapshot.rows.reduce((sum, row) => sum + row.file.size, 0) <=
        this.limits.maxTotalBytes
    );
  }
  async merge() {
    if (!this.canMerge()) return;
    this.abandon();
    const token = this.generation;
    const controller = new AbortController();
    this.abort = controller;
    const rows = this.snapshot.rows;
    this.publish({
      state: "processing",
      rows,
      announcement: "Loading the local PDF engine.",
    });
    let engine: { mergePdfs: Engine };
    try {
      engine = await this.dependencies.load();
    } catch {
      if (token === this.generation) {
        this.abort = undefined;
        this.selection(rows, "", "ENGINE_LOAD_FAILED");
      }
      return;
    }
    if (token !== this.generation) return;
    try {
      const result = await engine.mergePdfs(
        rows.map(({ id, file }) => ({ id, blob: file })),
        this.limits,
        {
          signal: controller.signal,
          onPhase: (phase) => {
            if (token === this.generation)
              this.publish({ ...this.snapshot, phase });
          },
        },
      );
      if (token !== this.generation) return;
      const url = this.dependencies.createUrl(result.blob);
      this.abort = undefined;
      this.publish({
        state: "result",
        rows,
        result: { ...result, url },
        announcement: "Your merged PDF is ready.",
      });
    } catch (caught) {
      if (token !== this.generation) return;
      this.abort = undefined;
      // Only our finite code vocabulary reaches the UI. Never preserve a cause.
      const candidate = caught as { code?: string; inputId?: string } | null;
      const code: WorkflowError =
        candidate?.code && Object.hasOwn(errorCopy, candidate.code)
          ? (candidate.code as WorkflowError)
          : "MERGE_FAILED";
      const marked = rows.map((row) =>
        row.id === candidate?.inputId ? { ...row, error: code } : row,
      );
      this.selection(marked, "", code);
    }
  }
  cancel() {
    if (this.snapshot.state !== "processing") return;
    this.abandon();
    this.selection(
      this.snapshot.rows,
      "Merge cancelled. Your selected files are still here.",
    );
  }
  edit() {
    if (this.snapshot.state !== "result") return;
    this.abandon();
    this.selection(this.snapshot.rows, "Ready to change the file order.");
  }
  reset = () => {
    this.abandon();
    this.publish({
      ...empty(),
      announcement: "Session cleared. Choose PDFs to start again.",
    });
  };
  dispose = () => {
    this.abandon();
    this.snapshot = empty();
  };
}

export function displayName(name: string): string {
  return (
    (name.split(/[\\/]/).pop() ?? "PDF")
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
      .slice(0, 160) || "PDF"
  );
}
export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KiB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
