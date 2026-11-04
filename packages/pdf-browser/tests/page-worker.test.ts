import { afterEach, expect, it, vi } from "vitest";
import { transformPages } from "../src/page-operation-client";
import { createPagePlan } from "../src/page-model";
import {
  pageLimits,
  type PageRequest,
  type PageResponse,
} from "../src/page-types";

class FakeWorker {
  static current: FakeWorker;
  onmessage: ((event: MessageEvent<PageResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(request: PageRequest) => void>();
  terminate = vi.fn();
  constructor() {
    FakeWorker.current = this;
  }
}
const input = {
  id: "opaque-session",
  blob: new File(["%PDF-test"], "private-name.pdf"),
};
const plan = createPagePlan(1, input.id);
afterEach(() => vi.unstubAllGlobals());
it("strips filenames and terminates on successful structural output", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const pending = transformPages(input, plan, pageLimits);
  const worker = FakeWorker.current;
  expect(worker.postMessage.mock.calls[0][0].input.blob).not.toHaveProperty(
    "name",
  );
  const result = { blob: new Blob(["%PDF-output"]), pageCount: 1 };
  worker.onmessage!({
    data: { kind: "result", result },
  } as MessageEvent<PageResponse>);
  await expect(pending).resolves.toEqual(result);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
});
it.each(["abort", "error", "messageerror"])(
  "terminates and rejects safely on %s",
  async (failure) => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const pending = transformPages(input, plan, pageLimits, {
      signal: controller.signal,
    });
    const worker = FakeWorker.current;
    if (failure === "abort") controller.abort();
    else if (failure === "error") {
      // It started (it spoke) and then crashed: the work failed.
      worker.onmessage!({
        data: { kind: "phase", phase: "reading" },
      } as MessageEvent);
      worker.onerror!({
        preventDefault: vi.fn(),
        message: "private parser text",
      } as unknown as ErrorEvent);
    } else worker.onmessageerror!();
    await expect(pending).rejects.toThrow(
      failure === "abort" ? "CANCELLED" : "OPERATION_FAILED",
    );
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  },
);

it("a worker that fails before it has said anything never started: it is a load failure, not a bad PDF", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const pending = transformPages(input, plan, pageLimits);
  FakeWorker.current.onerror!({
    preventDefault: vi.fn(),
  } as unknown as ErrorEvent);
  await expect(pending).rejects.toMatchObject({ code: "ENGINE_LOAD_FAILED" });
  expect(FakeWorker.current.terminate).toHaveBeenCalledTimes(1);
});
