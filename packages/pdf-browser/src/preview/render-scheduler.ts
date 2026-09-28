import { thumbnailLimits } from "./limits";
import type { PreviewDocument, ThumbnailSize } from "./types";

export type ThumbnailStatus = "idle" | "loading" | "ready" | "error";
export interface ThumbnailRequest {
  readonly id: string;
  readonly sourcePageNumber: number;
  readonly rotationDelta: number;
  readonly revision: string;
  readonly canvas: HTMLCanvasElement;
  readonly size: ThumbnailSize;
  readonly onState: (status: ThumbnailStatus) => void;
}
interface Active {
  entry: ThumbnailRequest;
  controller: AbortController;
  promise: Promise<void>;
}
const same = (a: ThumbnailRequest, b: ThumbnailRequest) =>
  a.id === b.id &&
  a.revision === b.revision &&
  a.canvas === b.canvas &&
  a.rotationDelta === b.rotationDelta &&
  a.size.width === b.size.width &&
  a.size.height === b.size.height &&
  a.size.dpr === b.size.dpr;
const release = (entry: ThumbnailRequest) => {
  entry.canvas.width = entry.canvas.height = 0;
};

/** One document's bounded canvas queue. Call update with visible pages first. */
export class ThumbnailScheduler {
  private wanted = new Map<string, ThumbnailRequest>();
  private ready = new Map<string, ThumbnailRequest>();
  private failed = new Set<ThumbnailRequest>();
  private active = new Map<HTMLCanvasElement, Active>();
  private paused = false;
  private closed = false;
  private peakActive = 0;
  private completed = 0;
  constructor(
    private readonly document: PreviewDocument,
    private readonly concurrency: 1 | 2 | 4 = 1,
  ) {}

  update(requests: readonly ThumbnailRequest[]) {
    if (this.closed) return;
    const next = new Map<string, ThumbnailRequest>();
    for (const request of requests.slice(
      0,
      Math.min(thumbnailLimits.maxQueued, thumbnailLimits.maxRetained),
    )) {
      if (next.has(request.id)) continue;
      const previous = this.wanted.get(request.id);
      next.set(
        request.id,
        previous && same(previous, request) ? previous : request,
      );
    }
    this.wanted = next;
    for (const { entry, controller } of this.active.values())
      if (next.get(entry.id) !== entry) controller.abort();
    for (const [id, entry] of this.ready) {
      if (next.get(id) !== entry) {
        release(entry);
        this.ready.delete(id);
        entry.onState("idle");
      }
    }
    for (const entry of this.failed)
      if (next.get(entry.id) !== entry) this.failed.delete(entry);
    this.pump();
  }
  private pump() {
    if (this.closed || this.paused) return;
    for (const entry of this.wanted.values()) {
      if (
        this.active.size >= this.concurrency ||
        this.active.size + this.ready.size >= thumbnailLimits.maxRetained
      )
        break;
      if (
        this.ready.get(entry.id) === entry ||
        this.failed.has(entry) ||
        this.active.has(entry.canvas) ||
        [...this.active.values()].some(
          ({ entry: active }) => active.id === entry.id,
        )
      )
        continue;
      const controller = new AbortController();
      entry.onState("loading");
      // Start in a microtask so active ownership is recorded before callbacks.
      const promise = Promise.resolve()
        .then(() =>
          this.document.render(
            entry.sourcePageNumber,
            entry.canvas,
            entry.rotationDelta,
            entry.size,
            controller.signal,
          ),
        )
        .then(
          () => {
            if (
              !controller.signal.aborted &&
              !this.closed &&
              this.wanted.get(entry.id) === entry
            ) {
              this.ready.set(entry.id, entry);
              this.completed++;
              entry.onState("ready");
            } else release(entry);
          },
          () => {
            release(entry);
            if (!this.closed && this.wanted.get(entry.id) === entry) {
              if (controller.signal.aborted) entry.onState("idle");
              else {
                this.failed.add(entry);
                entry.onState("error");
              }
            }
          },
        )
        .finally(() => {
          this.active.delete(entry.canvas);
          this.pump();
        });
      this.active.set(entry.canvas, { entry, controller, promise });
      this.peakActive = Math.max(this.peakActive, this.active.size);
    }
  }
  async pause() {
    this.paused = true;
    for (const { controller } of this.active.values()) controller.abort();
    await Promise.allSettled(
      [...this.active.values()].map(({ promise }) => promise),
    );
  }
  resume() {
    if (!this.closed) {
      this.paused = false;
      this.pump();
    }
  }
  async destroy() {
    if (this.closed) return;
    this.closed = true;
    await this.pause();
    for (const entry of this.ready.values()) release(entry);
    this.ready.clear();
    this.wanted.clear();
    this.failed.clear();
  }
  stats() {
    const canvases = new Set(
      [...this.ready.values()].map(({ canvas }) => canvas),
    );
    for (const canvas of this.active.keys()) canvases.add(canvas);
    return {
      active: this.active.size,
      peakActive: this.peakActive,
      retained: canvases.size,
      queued: this.wanted.size,
      completed: this.completed,
      canvasPixels: [...canvases].reduce(
        (sum, canvas) => sum + canvas.width * canvas.height,
        0,
      ),
      paused: this.paused,
    };
  }
}
