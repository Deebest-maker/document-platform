import { afterEach, expect, it, vi } from "vitest";
import { createPagePlan } from "../src/page-model";
import { splitPdf } from "../src/split-client";
import { splitLimits } from "../src/split-plan";
import type { SplitRequest, SplitResponse } from "../src/split-types";
import { pageLimits } from "../src/page-types";

class FakeWorker {
  static current: FakeWorker;
  onmessage: ((event: MessageEvent<SplitResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(request: SplitRequest) => void>();
  terminate = vi.fn();
  constructor() {
    FakeWorker.current = this;
  }
}

const input = {
  id: "split-worker",
  blob: new File(["%PDF-test"], "private-split-name.pdf"),
};
const plans = [createPagePlan(1, input.id)];
afterEach(() => vi.unstubAllGlobals());

it("strips the filename and terminates after an atomic worker result", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const pending = splitPdf(input, plans, pageLimits, {}, splitLimits);
  const worker = FakeWorker.current;
  expect(worker.postMessage.mock.calls[0][0].input.blob).not.toHaveProperty(
    "name",
  );
  const result = {
    blob: new Blob(["%PDF-output"], { type: "application/pdf" }),
    kind: "pdf" as const,
    fileCount: 1,
    pageCount: 1,
    combinedPdfBytes: 11,
  };
  worker.onmessage!({
    data: { kind: "result", result },
  } as MessageEvent<SplitResponse>);
  await expect(pending).resolves.toEqual(result);
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it.each(["abort", "error", "messageerror"])(
  "terminates and exposes only a safe error on %s",
  async (failure) => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const pending = splitPdf(
      input,
      plans,
      pageLimits,
      { signal: controller.signal },
      splitLimits,
    );
    const worker = FakeWorker.current;
    if (failure === "abort") controller.abort();
    else if (failure === "error")
      worker.onerror!({
        preventDefault: vi.fn(),
        message: "private parser detail",
      } as unknown as ErrorEvent);
    else worker.onmessageerror!();
    await expect(pending).rejects.toThrow(
      failure === "abort" ? "CANCELLED" : "OPERATION_FAILED",
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  },
);
