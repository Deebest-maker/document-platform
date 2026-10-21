import { afterEach, describe, expect, it, vi } from "vitest";
import { compressPdfInWorker } from "../src/compress-client";
import type {
  CompressRequest,
  CompressResponse,
} from "../src/compress-worker-protocol";
import {
  DEFAULT_COMPRESS_LIMITS,
  type CompressResult,
} from "../src/compress-types";

class FakeWorker {
  static current: FakeWorker;
  static fail = false;
  onmessage: ((event: MessageEvent<CompressResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(request: CompressRequest) => void>();
  terminate = vi.fn();
  constructor() {
    if (FakeWorker.fail) throw new Error("no workers");
    FakeWorker.current = this;
  }
}
const input = {
  id: "opaque-session",
  blob: new File(["%PDF-test"], "private-name.pdf"),
};
const limits = DEFAULT_COMPRESS_LIMITS;
const result: CompressResult = {
  outcome: "reduced",
  blob: new Blob(["%PDF-output"]),
  profile: "balanced",
  inputBytes: 10,
  outputBytes: 5,
  pageCount: 1,
  images: {
    found: 0,
    optimized: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    skipped: {},
  },
  streamsRecompressed: 0,
  streamsRepaired: 0,
  warnings: [],
  timingsMs: { load: 0, images: 0, structure: 0, save: 0, verify: 0, total: 0 },
};
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.fail = false;
});

describe("compress worker client", () => {
  it("sends an anonymous request and terminates on success", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const phases: string[] = [];
    const progress: number[] = [];
    const pending = compressPdfInWorker(input, "strong", limits, {
      onPhase: (p) => phases.push(p),
      onProgress: (p) => progress.push(p.done),
    });
    const worker = FakeWorker.current;
    const request = worker.postMessage.mock.calls[0][0];
    expect(request.input.blob).not.toHaveProperty("name");
    expect(request.profile).toBe("strong");
    expect(request.limits).toEqual(limits);
    worker.onmessage!({
      data: { kind: "phase", phase: "images" },
    } as MessageEvent<CompressResponse>);
    worker.onmessage!({
      data: {
        kind: "progress",
        progress: { phase: "images", done: 3, total: 4 },
      },
    } as MessageEvent<CompressResponse>);
    worker.onmessage!({
      data: { kind: "result", result },
    } as MessageEvent<CompressResponse>);
    await expect(pending).resolves.toEqual(result);
    expect(phases).toEqual(["images"]);
    expect(progress).toEqual([3]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
  });

  it("turns worker error codes into PageError", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const pending = compressPdfInWorker(input, "balanced", limits);
    FakeWorker.current.onmessage!({
      data: { kind: "error", code: "ENCRYPTED_PDF" },
    } as MessageEvent<CompressResponse>);
    await expect(pending).rejects.toMatchObject({
      name: "PageError",
      code: "ENCRYPTED_PDF",
    });
  });

  it.each(["abort", "error", "messageerror"])(
    "terminates and rejects safely on %s",
    async (failure) => {
      vi.stubGlobal("Worker", FakeWorker);
      const controller = new AbortController();
      const pending = compressPdfInWorker(input, "balanced", limits, {
        signal: controller.signal,
      });
      const worker = FakeWorker.current;
      if (failure === "abort") controller.abort();
      else if (failure === "error")
        worker.onerror!({
          preventDefault: vi.fn(),
          message: "private parser text",
        } as unknown as ErrorEvent);
      else worker.onmessageerror!();
      await expect(pending).rejects.toThrow(
        failure === "abort" ? "CANCELLED" : "OPERATION_FAILED",
      );
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );

  it("validates before starting a worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    await expect(
      compressPdfInWorker({ id: "x", blob: new Blob([]) }, "balanced", limits),
    ).rejects.toMatchObject({ code: "INPUT_LIMIT" });
    await expect(
      compressPdfInWorker(input, "extreme" as never, limits),
    ).rejects.toMatchObject({ code: "INVALID_PLAN" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      compressPdfInWorker(input, "balanced", limits, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("reports an unavailable worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.fail = true;
    await expect(
      compressPdfInWorker(input, "balanced", limits),
    ).rejects.toMatchObject({
      code: "WORKER_UNAVAILABLE",
    });
  });
});
