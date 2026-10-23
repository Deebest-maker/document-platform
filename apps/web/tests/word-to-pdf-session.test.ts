import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTool } from "@document-platform/tool-registry";
import {
  WordToPdfSession,
  displayName,
  formatBytes,
} from "../components/word-to-pdf/session";
import {
  ProcessorClientError,
  type JobCredentials,
  type JobState,
} from "../components/word-to-pdf/api";

const tool = getTool("word-to-pdf")!;

function makeFile(name: string, size: number, type = ""): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const urls = new Set<string>();
  let urlCounter = 0;
  return {
    createJob: vi.fn<() => Promise<JobCredentials>>().mockResolvedValue({
      id: "test-job-id",
      token: "test-token",
      state: "created",
    }),
    uploadInput: vi.fn().mockResolvedValue(undefined),
    convert: vi.fn<() => Promise<JobState>>().mockResolvedValue({
      id: "test-job-id",
      tool: "word-to-pdf",
      state: "succeeded",
      input_bytes: 1024,
      output_bytes: 2048,
      error_code: null,
    }),
    downloadOutput: vi
      .fn<() => Promise<Blob>>()
      .mockResolvedValue(
        new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }),
      ),
    deleteJob: vi.fn().mockResolvedValue(undefined),
    createUrl: vi.fn(() => {
      const url = `blob:test-${urlCounter++}`;
      urls.add(url);
      return url;
    }),
    revokeUrl: vi.fn((url: string) => {
      urls.delete(url);
    }),
    _urls: urls,
    ...overrides,
  };
}

describe("WordToPdfSession", () => {
  let deps: ReturnType<typeof makeDeps>;
  let session: WordToPdfSession;

  beforeEach(() => {
    deps = makeDeps();
    session = new WordToPdfSession(tool, deps);
  });

  it("starts in idle state", () => {
    const snap = session.getSnapshot();
    expect(snap.state).toBe("idle");
    expect(snap.file).toBeUndefined();
    expect(snap.result).toBeUndefined();
    expect(snap.error).toBeUndefined();
  });

  it("selects a valid DOCX file", () => {
    const file = makeFile("report.docx", 1024);
    session.select([file]);
    const snap = session.getSnapshot();
    expect(snap.state).toBe("selected");
    expect(snap.file).toBe(file);
    expect(snap.error).toBeUndefined();
  });

  it("rejects non-DOCX files", () => {
    session.select([makeFile("photo.jpg", 1024)]);
    expect(session.getSnapshot().state).toBe("error");
    expect(session.getSnapshot().error).toBe("UNSUPPORTED_TYPE");
  });

  it("rejects empty files as empty, not as the wrong type", () => {
    session.select([makeFile("empty.docx", 0)]);
    expect(session.getSnapshot().state).toBe("error");
    expect(session.getSnapshot().error).toBe("EMPTY_INPUT");
    expect(session.getSnapshot().announcement).toMatch(/empty/i);
  });

  it("rejects files exceeding maxFileBytes", () => {
    const oversize = makeFile("big.docx", 21 * 1024 * 1024);
    session.select([oversize]);
    expect(session.getSnapshot().state).toBe("error");
    expect(session.getSnapshot().error).toBe("FILE_TOO_LARGE");
  });

  it("ignores selection during processing", async () => {
    const file = makeFile("test.docx", 100);
    session.select([file]);

    // Make convert hang until aborted so we can test mid-flight
    deps.convert.mockImplementation(((...args: unknown[]) => {
      const signal = args[2] as AbortSignal;
      return new Promise<JobState>((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    }) as () => Promise<JobState>);
    const runPromise = session.run();

    // Wait for upload to complete so session is in converting state
    await vi.waitFor(() => {
      expect(session.getSnapshot().state).toBe("converting");
    });

    // Attempt selection during processing — should be ignored
    session.select([makeFile("other.docx", 200)]);
    expect(session.getSnapshot().state).toBe("converting");

    session.cancel();
    await runPromise;
  });

  it("runs the full conversion flow: upload → convert → download → delete", async () => {
    const file = makeFile("test.docx", 1024);
    session.select([file]);
    await session.run();

    expect(deps.createJob).toHaveBeenCalledOnce();
    expect(deps.uploadInput).toHaveBeenCalledWith(
      "test-job-id",
      "test-token",
      file,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(deps.convert).toHaveBeenCalledWith(
      "test-job-id",
      "test-token",
      expect.any(AbortSignal),
    );
    expect(deps.downloadOutput).toHaveBeenCalledWith(
      "test-job-id",
      "test-token",
      expect.any(AbortSignal),
    );
    // Server cleanup after download
    expect(deps.deleteJob).toHaveBeenCalledWith("test-job-id", "test-token");

    const snap = session.getSnapshot();
    expect(snap.state).toBe("result");
    expect(snap.result).toBeDefined();
    expect(snap.result!.url).toMatch(/^blob:/);
    expect(snap.result!.outputBytes).toBeGreaterThan(0);
  });

  it("notifies listeners on state changes", async () => {
    const listener = vi.fn();
    session.subscribe(listener);

    session.select([makeFile("test.docx", 100)]);
    expect(listener).toHaveBeenCalled();

    const countBefore = listener.mock.calls.length;
    await session.run();
    expect(listener.mock.calls.length).toBeGreaterThan(countBefore);
  });

  it("unsubscribes correctly", () => {
    const listener = vi.fn();
    const unsub = session.subscribe(listener);
    unsub();
    session.select([makeFile("test.docx", 100)]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("handles createJob failure as SERVER_UNAVAILABLE", async () => {
    deps.createJob.mockRejectedValue(new Error("network down"));
    session.select([makeFile("test.docx", 100)]);
    await session.run();

    const snap = session.getSnapshot();
    expect(snap.state).toBe("error");
    expect(snap.error).toBe("SERVER_UNAVAILABLE");
  });

  it("tells a rate-limited caller to wait, not that the server is down", async () => {
    deps.createJob.mockRejectedValue(
      new ProcessorClientError("RATE_LIMITED", "Too many", 429),
    );
    session.select([makeFile("test.docx", 100)]);
    await session.run();

    const snap = session.getSnapshot();
    expect(snap.state).toBe("error");
    expect(snap.error).toBe("RATE_LIMITED");
    expect(snap.announcement).toContain("Wait a minute");
    expect(deps.uploadInput).not.toHaveBeenCalled();
    // No job was created, so there is nothing to delete.
    expect(deps.deleteJob).not.toHaveBeenCalled();
  });

  it("treats any HTTP 429, even from a proxy without our error body, as rate limiting", async () => {
    deps.createJob.mockRejectedValue(
      new ProcessorClientError("UNKNOWN", "HTTP 429", 429),
    );
    session.select([makeFile("test.docx", 100)]);
    await session.run();
    expect(session.getSnapshot().error).toBe("RATE_LIMITED");
  });

  it("keeps a full service (503) as SERVER_UNAVAILABLE", async () => {
    deps.createJob.mockRejectedValue(
      new ProcessorClientError("NOT_READY", "not ready", 503),
    );
    session.select([makeFile("test.docx", 100)]);
    await session.run();
    expect(session.getSnapshot().error).toBe("SERVER_UNAVAILABLE");
  });

  it.each([
    ["INVALID_INPUT", 400, "INVALID_DOCUMENT", /could not be accepted/],
    ["CONVERSION_FAILED", 422, "CONVERSION_FAILED", /could not finish/],
    ["LIMIT_EXCEEDED", 413, "FILE_TOO_LARGE", /size limit/],
    ["INTERNAL", 500, "SERVER_UNAVAILABLE", /not available/],
  ])(
    "maps a %s answer to a convert request to %s, and cleans up",
    async (code, status, expected, wording) => {
      deps.convert.mockRejectedValue(
        new ProcessorClientError(code, "x", status),
      );
      session.select([makeFile("test.docx", 100)]);
      await session.run();

      const snap = session.getSnapshot();
      expect(snap.state).toBe("error");
      expect(snap.error).toBe(expected);
      expect(snap.announcement).toMatch(wording);
      expect(deps.deleteJob).toHaveBeenCalledTimes(1);
      expect(deps.downloadOutput).not.toHaveBeenCalled();
    },
  );

  it("handles upload failure as UPLOAD_FAILED", async () => {
    deps.uploadInput.mockRejectedValue(new Error("connection lost"));
    session.select([makeFile("test.docx", 100)]);
    await session.run();

    const snap = session.getSnapshot();
    expect(snap.state).toBe("error");
    expect(snap.error).toBe("UPLOAD_FAILED");
    // Cleanup should still be called
    expect(deps.deleteJob).toHaveBeenCalled();
  });

  it("handles conversion failure as CONVERSION_FAILED", async () => {
    deps.convert.mockRejectedValue(new Error("engine error"));
    session.select([makeFile("test.docx", 100)]);
    await session.run();

    const snap = session.getSnapshot();
    expect(snap.state).toBe("error");
    expect(snap.error).toBe("CONVERSION_FAILED");
    expect(deps.deleteJob).toHaveBeenCalled();
  });

  it("handles download failure as DOWNLOAD_FAILED", async () => {
    deps.downloadOutput.mockRejectedValue(new Error("download error"));
    session.select([makeFile("test.docx", 100)]);
    await session.run();

    const snap = session.getSnapshot();
    expect(snap.state).toBe("error");
    expect(snap.error).toBe("DOWNLOAD_FAILED");
    expect(deps.deleteJob).toHaveBeenCalled();
  });

  it("cancels an in-progress conversion and returns to selected", async () => {
    // Make convert hang until aborted
    deps.convert.mockImplementation(((...args: unknown[]) => {
      const signal = args[2] as AbortSignal;
      return new Promise<JobState>((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    }) as () => Promise<JobState>);

    session.select([makeFile("test.docx", 100)]);
    const runPromise = session.run();

    await vi.waitFor(() => {
      expect(session.getSnapshot().state).toBe("converting");
    });

    session.cancel();
    const snap = session.getSnapshot();
    expect(snap.state).toBe("selected");
    expect(snap.file).toBeDefined();

    await runPromise;
  });

  it("resets to idle and cleans up", async () => {
    session.select([makeFile("test.docx", 100)]);
    await session.run();
    expect(session.getSnapshot().state).toBe("result");

    session.reset();
    const snap = session.getSnapshot();
    expect(snap.state).toBe("idle");
    expect(snap.file).toBeUndefined();
    expect(snap.result).toBeUndefined();
    // Blob URL should have been revoked
    expect(deps.revokeUrl).toHaveBeenCalled();
  });

  it("disposes cleanly", async () => {
    session.select([makeFile("test.docx", 100)]);
    await session.run();

    session.dispose();
    expect(session.getSnapshot().state).toBe("idle");
    expect(deps.revokeUrl).toHaveBeenCalled();
  });

  it("canConvert is true only in selected state with a valid file", () => {
    expect(session.canConvert()).toBe(false);

    session.select([makeFile("test.docx", 100)]);
    expect(session.canConvert()).toBe(true);

    session.select([makeFile("bad.txt", 100)]);
    expect(session.canConvert()).toBe(false);
  });
});

describe("displayName", () => {
  it("extracts the filename from a path", () => {
    expect(displayName("C:\\Users\\test\\report.docx")).toBe("report.docx");
    expect(displayName("/home/user/report.docx")).toBe("report.docx");
  });

  it("strips control characters", () => {
    expect(displayName("test\u0000.docx")).toBe("test.docx");
    expect(displayName("test\u202a.docx")).toBe("test.docx");
  });

  it("truncates to 160 characters", () => {
    const long = "a".repeat(200) + ".docx";
    expect(displayName(long).length).toBe(160);
  });

  it("falls back to Document for empty names", () => {
    expect(displayName("")).toBe("Document");
  });
});

describe("formatBytes", () => {
  it("formats small sizes in KiB", () => {
    expect(formatBytes(512)).toBe("1 KiB");
    expect(formatBytes(2048)).toBe("2 KiB");
  });
  it("formats larger sizes in MiB", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MiB");
    expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MiB");
  });
});
