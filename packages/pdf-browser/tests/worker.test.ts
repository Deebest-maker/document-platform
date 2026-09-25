import { afterEach, describe, expect, it, vi } from "vitest";
import { mergePdfs } from "../src/worker-client";
import type { MergeResponse } from "../src/worker-protocol";

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent<MergeResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
}
const limits = {
  maxFiles: 2,
  maxFileBytes: 100,
  maxTotalBytes: 200,
  maxPages: 2,
  maxOutputBytes: 200,
};
const inputs = ["one", "two"].map((id) => ({
  id,
  blob: new File(["%PDF-synthetic"], "sensitive-name.pdf"),
}));
afterEach(() => vi.unstubAllGlobals());
describe("worker boundary and cancellation", () => {
  it("sends plain Blobs with opaque IDs, forwards phases/results, terminates exactly once", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const onPhase = vi.fn();
    const work = mergePdfs(inputs, limits, { onPhase });
    const worker = FakeWorker.latest;
    const sent = worker.postMessage.mock.calls[0][0];
    expect(sent.inputs[0].blob).not.toBeInstanceOf(File);
    expect(sent.inputs[0].blob.size).toBe(inputs[0].blob.size);
    expect(JSON.stringify(sent)).not.toContain("sensitive-name");
    worker.onmessage!({
      data: { kind: "phase", phase: "reading" },
    } as MessageEvent<MergeResponse>);
    const result = { blob: new Blob(["result"]), pageCount: 2, inputCount: 2 };
    worker.onmessage!({
      data: { kind: "result", result },
    } as MessageEvent<MergeResponse>);
    await expect(work).resolves.toEqual(result);
    expect(onPhase).toHaveBeenCalledWith("reading");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
  });
  it("terminates immediately on abort and does not accept stale messages", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const work = mergePdfs(inputs, limits, { signal: controller.signal });
    const worker = FakeWorker.latest;
    const stale = worker.onmessage!;
    controller.abort();
    await expect(work).rejects.toMatchObject({ code: "CANCELLED" });
    stale({
      data: { kind: "error", code: "INVALID_PDF" },
    } as MessageEvent<MergeResponse>);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(
      mergePdfs(inputs, limits, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("maps unavailable workers, crashes and message failures without raw diagnostics", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(mergePdfs(inputs, limits)).rejects.toMatchObject({
      code: "WORKER_UNAVAILABLE",
    });
    vi.stubGlobal("Worker", FakeWorker);
    const crash = mergePdfs(inputs, limits);
    const preventDefault = vi.fn();
    FakeWorker.latest.onerror!({
      preventDefault,
      message: "private parser error",
    } as unknown as ErrorEvent);
    await expect(crash).rejects.toMatchObject({ message: "MERGE_FAILED" });
    expect(preventDefault).toHaveBeenCalled();
    const malformed = mergePdfs(inputs, limits);
    FakeWorker.latest.onmessageerror!();
    await expect(malformed).rejects.toMatchObject({ code: "MERGE_FAILED" });
  });
});
