import { expect, it, vi } from "vitest";
import {
  ThumbnailScheduler,
  type ThumbnailRequest,
} from "../src/preview/render-scheduler";
import type { PreviewDocument } from "../src/preview/types";
function setup(concurrency: 1 | 2 | 4 = 1) {
  const pending: {
    resolve: () => void;
    reject: () => void;
    signal: AbortSignal;
    canvas: HTMLCanvasElement;
  }[] = [];
  const document: PreviewDocument = {
    sessionId: "one",
    pageCount: 200,
    geometry: vi.fn(),
    destroy: vi.fn(),
    render: vi.fn(
      (_page, canvas, _rotation, _size, signal) =>
        new Promise<void>((resolve, reject) => {
          canvas.width = 480;
          canvas.height = 640;
          pending.push({
            resolve,
            reject: () => reject(new Error("render failure")),
            signal: signal!,
            canvas,
          });
        }),
    ),
  };
  const scheduler = new ThumbnailScheduler(document, concurrency);
  const requests = Array.from({ length: 20 }, (_, i): ThumbnailRequest => ({
    id: `p${i}`,
    sourcePageNumber: i + 1,
    rotationDelta: 0,
    revision: "0",
    canvas: { width: 0, height: 0 } as HTMLCanvasElement,
    size: { width: 240, height: 320, dpr: 2 },
    onState: vi.fn(),
  }));
  return { scheduler, requests, pending, document };
}
it.each([1, 2, 4] as const)(
  "bounds rendering at concurrency %s and owned canvases at eight",
  async (concurrency) => {
    const f = setup(concurrency);
    f.scheduler.update(f.requests);
    await vi.waitFor(() => expect(f.pending).toHaveLength(concurrency));
    expect(f.scheduler.stats().active).toBe(concurrency);
    expect(f.scheduler.stats().queued).toBe(8);
    for (let index = 0; index < 8; index++) {
      await vi.waitFor(() => expect(f.pending.length).toBeGreaterThan(index));
      f.pending[index].resolve();
    }
    await vi.waitFor(() => expect(f.scheduler.stats().completed).toBe(8));
    expect(f.scheduler.stats().peakActive).toBe(concurrency);
    expect(f.scheduler.stats().canvasPixels).toBe(8 * 480 * 640);
    f.scheduler.update([]);
    expect(f.requests.every(({ canvas }) => canvas.width === 0)).toBe(true);
    await f.scheduler.destroy();
  },
);
it("never reuses a cancelled canvas before its previous render settles", async () => {
  const f = setup();
  f.scheduler.update([f.requests[0]]);
  await vi.waitFor(() => expect(f.pending).toHaveLength(1));
  const next = {
    ...f.requests[0],
    rotationDelta: 90,
    revision: "1",
    onState: vi.fn(),
  };
  f.scheduler.update([next]);
  expect(f.pending[0].signal.aborted).toBe(true);
  expect(f.document.render).toHaveBeenCalledTimes(1);
  expect(next.canvas.width).toBe(480); // Still owned by the unsettled old task.
  f.pending[0].reject();
  await vi.waitFor(() => expect(f.pending).toHaveLength(2));
  expect(f.requests[0].onState).not.toHaveBeenCalledWith("ready");
  f.pending[1].resolve();
  await vi.waitFor(() => expect(next.onState).toHaveBeenCalledWith("ready"));
  await f.scheduler.destroy();
  expect(next.canvas.width).toBe(0);
});
it("pauses for export, reports errors without dropping page identity, then releases all surfaces", async () => {
  const f = setup();
  f.scheduler.update([f.requests[0], f.requests[1]]);
  await vi.waitFor(() => expect(f.pending).toHaveLength(1));
  const paused = f.scheduler.pause();
  expect(f.pending[0].signal.aborted).toBe(true);
  f.pending[0].reject();
  await paused;
  expect(f.document.render).toHaveBeenCalledTimes(1);
  expect(f.scheduler.stats().paused).toBe(true);
  f.scheduler.resume();
  await vi.waitFor(() => expect(f.pending).toHaveLength(2));
  f.pending[1].reject();
  await vi.waitFor(() =>
    expect(f.requests[0].onState).toHaveBeenCalledWith("error"),
  );
  await vi.waitFor(() => expect(f.pending).toHaveLength(3));
  const closed = f.scheduler.destroy();
  f.pending[2].reject();
  await closed;
  expect(f.scheduler.stats()).toMatchObject({
    active: 0,
    retained: 0,
    queued: 0,
    canvasPixels: 0,
  });
});
