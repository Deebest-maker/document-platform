/**
 * Processor API client for Word-to-PDF conversion.
 *
 * All endpoints are proxied through Next.js rewrites:
 *   /api/processor/* → PROCESSOR_ORIGIN/v1/*
 *
 * The client stores only the job ID and capability token in memory.
 * Neither value is persisted to localStorage or cookies.
 */

/** Processor error shape returned by the API. */
export interface ProcessorApiError {
  code: string;
  message: string;
}

/** Job state as returned by GET /api/processor/jobs/{id}. */
export interface JobState {
  id: string;
  tool: string;
  state: string;
  input_bytes: number;
  output_bytes: number;
  error_code: string | null;
}

/** Credentials returned by POST /api/processor/jobs. */
export interface JobCredentials {
  id: string;
  token: string;
  state: string;
}

/**
 * Upload progress callback.
 * @param loaded  Bytes sent so far.
 * @param total   Total bytes to send (0 if unknown).
 */
export type UploadProgressCallback = (loaded: number, total: number) => void;

const BASE = "/api/processor/jobs";

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Read the processor's error body.
 *
 * The processor is a FastAPI app, so failures arrive as
 * `{"detail": {"code": "limit_exceeded", "message": "..."}}` with lowercase
 * codes. This returns `{ code: "LIMIT_EXCEEDED", message }` (codes are
 * upper-cased so callers compare against one vocabulary), or `undefined` for
 * anything that is not that shape (proxy error pages, FastAPI validation
 * lists, empty bodies).
 */
export function parseProcessorError(
  body: unknown,
): ProcessorApiError | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const { code, message } = detail as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || code === "") return undefined;
  return {
    code: code.toUpperCase(),
    message: typeof message === "string" ? message : "",
  };
}

async function ensureOk(response: Response): Promise<void> {
  if (!response.ok) {
    let detail: ProcessorApiError | undefined;
    try {
      detail = parseProcessorError(await response.json());
    } catch {
      /* body may not be JSON */
    }
    throw new ProcessorClientError(
      detail?.code ?? "UNKNOWN",
      detail?.message ?? `HTTP ${response.status}`,
      response.status,
    );
  }
}

export class ProcessorClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProcessorClientError";
  }
}

/** Create a new conversion job. */
export async function createJob(): Promise<JobCredentials> {
  const response = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "word-to-pdf" }),
  });
  await ensureOk(response);
  return (await response.json()) as JobCredentials;
}

/**
 * Upload the input DOCX file using XMLHttpRequest for upload progress.
 *
 * fetch() does not support upload progress events, so XHR is used here.
 * The returned promise resolves when the upload completes or rejects on
 * network error or a non-2xx response.
 */
export function uploadInput(
  jobId: string,
  token: string,
  file: File,
  onProgress?: UploadProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${BASE}/${encodeURIComponent(jobId)}/input`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          xhr.abort();
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    }

    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        onProgress(event.loaded, event.lengthComputable ? event.total : 0);
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let detail: ProcessorApiError | undefined;
        try {
          detail = parseProcessorError(JSON.parse(xhr.responseText));
        } catch {
          /* response may not be JSON */
        }
        reject(
          new ProcessorClientError(
            detail?.code ?? "UNKNOWN",
            detail?.message ?? `HTTP ${xhr.status}`,
            xhr.status,
          ),
        );
      }
    });

    xhr.addEventListener("error", () => {
      reject(new ProcessorClientError("NETWORK", "Upload failed", 0));
    });

    xhr.send(file);
  });
}

/** Kick off conversion and wait for the synchronous result. */
export async function convert(
  jobId: string,
  token: string,
  signal?: AbortSignal,
): Promise<JobState> {
  const response = await fetch(`${BASE}/${encodeURIComponent(jobId)}/convert`, {
    method: "POST",
    headers: authHeaders(token),
    signal,
  });
  await ensureOk(response);
  return (await response.json()) as JobState;
}

/** Download the converted PDF as a Blob. */
export async function downloadOutput(
  jobId: string,
  token: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(`${BASE}/${encodeURIComponent(jobId)}/output`, {
    method: "GET",
    headers: authHeaders(token),
    signal,
  });
  await ensureOk(response);
  return response.blob();
}

/** Delete the job and its workspace (idempotent). */
export async function deleteJob(jobId: string, token: string): Promise<void> {
  // Fire-and-forget cleanup. We don't propagate errors from deletion
  // because the user's session is ending anyway.
  try {
    await fetch(`${BASE}/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
  } catch {
    // Swallow network errors — cleanup is best-effort.
  }
}
