/**
 * WordToPdfSession — external store for the Word-to-PDF conversion flow.
 *
 * Follows the same subscribe/getSnapshot pattern as MergeSession so the
 * React component can use `useSyncExternalStore` without extra wrappers.
 *
 * Flow:  idle → selected → uploading → converting → result | error
 *
 * Credentials (job ID + capability token) are held only in memory; they
 * are never persisted to localStorage, cookies or URLs.
 */

import type { ToolDefinition } from "@document-platform/tool-registry";
import {
  createJob,
  uploadInput,
  convert,
  downloadOutput,
  deleteJob,
  ProcessorClientError,
  type UploadProgressCallback,
} from "./api";

// ── Error vocabulary ──────────────────────────────────────────────────

export type ConversionErrorCode =
  | "UNSUPPORTED_TYPE"
  | "FILE_TOO_LARGE"
  | "UPLOAD_FAILED"
  | "CONVERSION_FAILED"
  | "DOWNLOAD_FAILED"
  | "SERVER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "CANCELLED";

export const errorCopy: Record<ConversionErrorCode, string> = {
  UNSUPPORTED_TYPE:
    "This file is not a supported DOCX document. Choose a .docx file.",
  FILE_TOO_LARGE:
    "This file exceeds the size limit. Choose a smaller document.",
  UPLOAD_FAILED:
    "The upload could not complete. Check your connection and try again.",
  CONVERSION_FAILED:
    "The conversion could not finish. The document may be damaged, password-protected or contain unsupported features.",
  DOWNLOAD_FAILED: "The converted PDF could not be downloaded. Try again.",
  SERVER_UNAVAILABLE:
    "The processing server is not available right now. Try again in a moment.",
  RATE_LIMITED:
    "Too many conversions were started from this connection. Wait a minute, then try again.",
  CANCELLED: "Conversion cancelled.",
};

// ── Snapshot ───────────────────────────────────────────────────────────

export type SessionState =
  "idle" | "selected" | "uploading" | "converting" | "result" | "error";

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface ConversionResult {
  blob: Blob;
  url: string;
  outputBytes: number;
}

export interface Snapshot {
  state: SessionState;
  file?: File;
  progress?: UploadProgress;
  error?: ConversionErrorCode;
  result?: ConversionResult;
  announcement: string;
}

// ── Dependencies (injectable for testing) ─────────────────────────────

interface Dependencies {
  createJob: typeof createJob;
  uploadInput: typeof uploadInput;
  convert: typeof convert;
  downloadOutput: typeof downloadOutput;
  deleteJob: typeof deleteJob;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
}

const defaults: Dependencies = {
  createJob,
  uploadInput,
  convert,
  downloadOutput,
  deleteJob,
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
};

const empty = (): Snapshot => ({ state: "idle", announcement: "" });

// ── Session ───────────────────────────────────────────────────────────

export class WordToPdfSession {
  private snapshot: Snapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort?: AbortController;
  private jobId?: string;
  private token?: string;
  private readonly deps: Dependencies;
  private readonly maxFileBytes: number;

  constructor(tool: ToolDefinition, dependencies: Partial<Dependencies> = {}) {
    this.deps = { ...defaults, ...dependencies };
    this.maxFileBytes = tool.limits?.maxFileBytes ?? 20 * 1024 * 1024;
  }

  // ── External store protocol ───────────────────────────────────────

  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // ── Internal helpers ──────────────────────────────────────────────

  private publish(next: Snapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  private releaseResult(): void {
    if (this.snapshot.result) {
      this.deps.revokeUrl(this.snapshot.result.url);
    }
  }

  private cleanup(): void {
    if (this.jobId && this.token) {
      void this.deps.deleteJob(this.jobId, this.token);
    }
    this.jobId = undefined;
    this.token = undefined;
  }

  private abandon(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    this.releaseResult();
    this.cleanup();
  }

  // ── Validate client-side ──────────────────────────────────────────

  private validateFile(file: File): ConversionErrorCode | undefined {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".docx")) return "UNSUPPORTED_TYPE";
    if (file.size === 0) return "UNSUPPORTED_TYPE";
    if (file.size > this.maxFileBytes) return "FILE_TOO_LARGE";
    return undefined;
  }

  // ── Public actions ────────────────────────────────────────────────

  select(files: readonly File[]): void {
    if (
      this.snapshot.state === "uploading" ||
      this.snapshot.state === "converting" ||
      this.snapshot.state === "result" ||
      files.length === 0
    )
      return;
    const file = files[0];
    const error = this.validateFile(file);
    if (error) {
      this.publish({
        state: "error",
        file,
        error,
        announcement: errorCopy[error],
      });
      return;
    }
    this.publish({
      state: "selected",
      file,
      announcement: `${file.name} selected.`,
    });
  }

  canConvert(): boolean {
    return (
      this.snapshot.state === "selected" &&
      this.snapshot.file !== undefined &&
      !this.snapshot.error
    );
  }

  async run(): Promise<void> {
    if (!this.canConvert() || !this.snapshot.file) return;
    this.abandon();

    const token = this.generation;
    const controller = new AbortController();
    this.abort = controller;
    const file = this.snapshot.file;

    // ── Upload phase ──────────────────────────────────────────────

    this.publish({
      state: "uploading",
      file,
      progress: { loaded: 0, total: file.size },
      announcement: "Uploading your document.",
    });

    let jobCreds: { id: string; token: string };
    try {
      jobCreds = await this.deps.createJob();
    } catch (err) {
      if (token !== this.generation) return;
      this.abort = undefined;
      // Being asked to slow down is not the server being down.
      const code = mapProcessorError(err, "SERVER_UNAVAILABLE");
      this.publish({
        state: "error",
        file,
        error: code,
        announcement: errorCopy[code],
      });
      return;
    }
    if (token !== this.generation) return;
    this.jobId = jobCreds.id;
    this.token = jobCreds.token;

    const onProgress: UploadProgressCallback = (loaded, total) => {
      if (token === this.generation) {
        this.publish({
          ...this.snapshot,
          progress: { loaded, total: total || file.size },
        });
      }
    };

    try {
      await this.deps.uploadInput(
        jobCreds.id,
        jobCreds.token,
        file,
        onProgress,
        controller.signal,
      );
    } catch (err) {
      if (token !== this.generation) return;
      this.abort = undefined;
      if (err instanceof DOMException && err.name === "AbortError") return;
      const code = mapProcessorError(err, "UPLOAD_FAILED");
      this.publish({
        state: "error",
        file,
        error: code,
        announcement: errorCopy[code],
      });
      this.cleanup();
      return;
    }
    if (token !== this.generation) return;

    // ── Conversion phase ──────────────────────────────────────────

    this.publish({
      state: "converting",
      file,
      announcement: "Converting your document to PDF.",
    });

    try {
      await this.deps.convert(jobCreds.id, jobCreds.token, controller.signal);
    } catch (err) {
      if (token !== this.generation) return;
      this.abort = undefined;
      if (err instanceof DOMException && err.name === "AbortError") return;
      const code = mapProcessorError(err, "CONVERSION_FAILED");
      this.publish({
        state: "error",
        file,
        error: code,
        announcement: errorCopy[code],
      });
      this.cleanup();
      return;
    }
    if (token !== this.generation) return;

    // ── Download phase ────────────────────────────────────────────

    let blob: Blob;
    try {
      blob = await this.deps.downloadOutput(
        jobCreds.id,
        jobCreds.token,
        controller.signal,
      );
    } catch (err) {
      if (token !== this.generation) return;
      this.abort = undefined;
      if (err instanceof DOMException && err.name === "AbortError") return;
      this.publish({
        state: "error",
        file,
        error: "DOWNLOAD_FAILED",
        announcement: errorCopy.DOWNLOAD_FAILED,
      });
      this.cleanup();
      return;
    }
    if (token !== this.generation) return;

    // ── Done — delete server workspace, keep local blob ───────────

    const url = this.deps.createUrl(blob);
    this.abort = undefined;
    this.cleanup();
    this.publish({
      state: "result",
      file,
      result: { blob, url, outputBytes: blob.size },
      announcement: "Your PDF is ready to download.",
    });
  }

  cancel(): void {
    if (
      this.snapshot.state !== "uploading" &&
      this.snapshot.state !== "converting"
    )
      return;
    const file = this.snapshot.file;
    this.abandon();
    this.publish({
      state: file ? "selected" : "idle",
      file,
      announcement: "Conversion cancelled.",
    });
  }

  reset = (): void => {
    this.abandon();
    this.publish({
      ...empty(),
      announcement: "Session cleared. Choose a DOCX file to start again.",
    });
  };

  dispose = (): void => {
    this.abandon();
    this.snapshot = empty();
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

export function displayName(name: string): string {
  return (
    (name.split(/[\\/]/).pop() ?? "Document")
      .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "")
      .slice(0, 160) || "Document"
  );
}

export const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KiB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

function mapProcessorError(
  err: unknown,
  fallback: ConversionErrorCode,
): ConversionErrorCode {
  if (err instanceof ProcessorClientError) {
    if (err.code === "RATE_LIMITED" || err.status === 429)
      return "RATE_LIMITED";
    if (err.code === "LIMIT_EXCEEDED") return "FILE_TOO_LARGE";
    if (err.code === "INVALID_INPUT") return "UNSUPPORTED_TYPE";
    if (err.status === 0 || err.status >= 500) return "SERVER_UNAVAILABLE";
  }
  return fallback;
}
