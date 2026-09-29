import {
  createPagePlan,
  deletePages,
  extractPages,
  reorderPages,
  rotatePages,
  type PagePlan,
  type PageGeometry,
} from "@document-platform/pdf-browser/page-model";
import {
  PageError,
  pageLimits,
  type PageInput,
  type PageResult,
  type PageOperationOptions,
  type PageLimits,
  type PagePhase,
} from "@document-platform/pdf-browser/pages";
import type {
  PreviewDocument,
  ThumbnailScheduler,
  ThumbnailStatus,
  ThumbnailRequest,
} from "@document-platform/pdf-browser/preview";

export interface PageSnapshot {
  readonly state:
    "empty" | "loading" | "ready" | "exporting" | "result" | "error";
  readonly plan?: PagePlan;
  readonly selected: readonly string[];
  readonly thumbnails: Readonly<Record<string, ThumbnailStatus>>;
  readonly geometry: Readonly<Record<string, PageGeometry>>;
  readonly error?: PageError["code"];
  readonly result?: { readonly url: string; readonly pageCount: number };
  readonly phase?: PagePhase;
  readonly announcement: string;
}
type Opened = { preview: PreviewDocument; scheduler: ThumbnailScheduler };
interface Services {
  open: (input: PageInput, signal: AbortSignal) => Promise<Opened>;
  transform: (
    input: PageInput,
    plan: PagePlan,
    options: PageOperationOptions,
  ) => Promise<PageResult>;
  id: () => string;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
}
const defaults: Pick<Services, "id" | "createUrl" | "revokeUrl"> = {
  id: () => crypto.randomUUID(),
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
};
const empty = (): PageSnapshot => ({
  state: "empty",
  selected: [],
  thumbnails: {},
  geometry: {},
  announcement: "",
});

// App-owned, route-local document state. No raw PDF engine objects in React.
export class PreviewSession {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private file?: File;
  private opened?: Opened;
  private opening?: Promise<Opened>;
  private loadAbort?: AbortController;
  private exportAbort?: AbortController;
  private disposal: Promise<void> = Promise.resolve();
  private readonly services: Services;
  constructor(
    services: Partial<Services> = {},
    readonly limits: PageLimits = pageLimits,
  ) {
    this.services = {
      ...defaults,
      open:
        services.open ??
        (async (input, signal) => {
          const previewModule =
            await import("@document-platform/pdf-browser/preview");
          const preview = await previewModule.openPreview(input, limits, {
            signal,
          });
          return {
            preview,
            scheduler: new previewModule.ThumbnailScheduler(preview),
          };
        }),
      transform:
        services.transform ??
        (async (input, plan, options) =>
          (await import("@document-platform/pdf-browser/pages")).transformPages(
            input,
            plan,
            limits,
            options,
          )),
      ...services,
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(snapshot: PageSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
  private clearResult() {
    if (this.snapshot.result) this.services.revokeUrl(this.snapshot.result.url);
  }
  private release() {
    this.clearResult();
    this.loadAbort?.abort();
    this.exportAbort?.abort();
    const opened = this.opened,
      opening = this.opening;
    this.opened = undefined;
    this.opening = undefined;
    this.file = undefined;
    this.loadAbort = undefined;
    this.exportAbort = undefined;
    this.disposal = this.disposal.then(async () => {
      const resources = opened ?? (await opening?.catch(() => undefined));
      if (resources) {
        await resources.scheduler.destroy();
        await resources.preview.destroy();
      }
    });
    return this.disposal;
  }
  async setSource(file: File) {
    const generation = ++this.generation;
    const released = this.release();
    this.publish({
      ...empty(),
      state: "loading",
      announcement: "Opening local PDF.",
    });
    await released;
    if (generation !== this.generation) return;
    if (
      !/\.pdf$/i.test(file.name) ||
      (file.type &&
        !["application/pdf", "application/octet-stream"].includes(file.type)) ||
      file.size < 1 ||
      file.size > this.limits.maxInputBytes
    ) {
      this.publish({
        ...empty(),
        state: "error",
        error: "INPUT_LIMIT",
        announcement: "Choose a PDF within the current limits.",
      });
      return;
    }
    const abort = new AbortController();
    this.loadAbort = abort;
    const id = this.services.id();
    this.file = file;
    this.opening = this.services.open(
      { id, blob: file.slice(0, file.size, file.type) },
      abort.signal,
    );
    try {
      const opened = await this.opening;
      if (generation !== this.generation) {
        await opened.scheduler.destroy();
        await opened.preview.destroy();
        return;
      }
      this.opened = opened;
      this.opening = undefined;
      this.publish({
        ...empty(),
        state: "ready",
        plan: createPagePlan(opened.preview.pageCount, id),
        announcement: `${opened.preview.pageCount} pages ready. Previews load as needed.`,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.file = undefined;
      this.opening = undefined;
      this.publish({
        ...empty(),
        state: "error",
        error: error instanceof PageError ? error.code : "PREVIEW_FAILED",
        announcement: "The PDF preview could not open.",
      });
    }
  }
  reset = () => {
    ++this.generation;
    const pending = this.release();
    this.publish(empty());
    return pending;
  };
  destroy = () => {
    const pending = this.reset();
    this.listeners.clear();
    return pending;
  };
  select(id: string, checked: boolean) {
    if (
      !this.snapshot.plan?.pages.some((page) => page.id === id) ||
      this.snapshot.state === "exporting"
    )
      return;
    const selected = new Set(this.snapshot.selected);
    if (checked) selected.add(id);
    else selected.delete(id);
    this.publish({ ...this.snapshot, selected: [...selected] });
  }
  selectAll() {
    if (!this.snapshot.plan || this.snapshot.state === "exporting") return;
    this.publish({
      ...this.snapshot,
      selected: this.snapshot.plan.pages.map(({ id }) => id),
      announcement: `All ${this.snapshot.plan.pages.length} pages selected.`,
    });
  }
  clearSelection() {
    if (!this.snapshot.plan || this.snapshot.state === "exporting") return;
    this.publish({
      ...this.snapshot,
      selected: [],
      announcement: "Page selection cleared.",
    });
  }
  private edit(makePlan: (plan: PagePlan) => PagePlan, announcement: string) {
    if (!this.snapshot.plan || this.snapshot.state === "exporting") return;
    try {
      const plan = makePlan(this.snapshot.plan);
      this.clearResult();
      this.publish({
        ...this.snapshot,
        plan,
        result: undefined,
        error: undefined,
        state: "ready",
        selected: this.snapshot.selected.filter((id) =>
          plan.pages.some((page) => page.id === id),
        ),
        announcement,
      });
    } catch (error) {
      this.publish({
        ...this.snapshot,
        error: error instanceof PageError ? error.code : "INVALID_PLAN",
        announcement: "That page operation is not valid.",
      });
    }
  }
  move(id: string, direction: -1 | 1) {
    const current = this.snapshot.plan?.pages,
      currentIndex = current?.findIndex((page) => page.id === id) ?? -1,
      targetIndex = currentIndex + direction,
      sourcePage = current?.[currentIndex]?.sourcePageNumber;
    this.edit(
      (plan) => {
        const ids = plan.pages.map((page) => page.id),
          index = ids.indexOf(id),
          target = index + direction;
        if (index < 0 || target < 0 || target >= ids.length)
          throw new PageError("INVALID_PLAN");
        [ids[index], ids[target]] = [ids[target], ids[index]];
        return reorderPages(plan, ids);
      },
      sourcePage && current
        ? `Source page ${sourcePage} moved to position ${targetIndex + 1} of ${current.length}.`
        : "Page order updated.",
    );
  }
  extract() {
    this.edit(
      (plan) => extractPages(plan, this.snapshot.selected),
      "Selected pages retained in document order.",
    );
  }
  delete() {
    this.edit(
      (plan) => deletePages(plan, this.snapshot.selected),
      "Selected pages removed.",
    );
  }
  rotate(all = false, quarterTurn: -90 | 90 = 90) {
    const count = all
      ? this.snapshot.plan?.pages.length
      : this.snapshot.selected.length;
    this.edit(
      (plan) =>
        rotatePages(plan, all ? "all" : this.snapshot.selected, quarterTurn),
      `${count ?? 0} ${count === 1 ? "page" : "pages"} rotated ${quarterTurn > 0 ? "right" : "left"}.`,
    );
  }
  updateVisible(requests: readonly Omit<ThumbnailRequest, "onState">[]) {
    const opened = this.opened,
      generation = this.generation;
    if (!opened || !this.snapshot.plan) return;
    const current = new Map(
      this.snapshot.plan.pages.map((page) => [page.id, page]),
    );
    opened.scheduler.update(
      requests
        .filter((request) => current.has(request.id))
        .map((request) => ({
          ...request,
          onState: (status) => {
            if (
              generation !== this.generation ||
              this.snapshot.plan?.pages.find(({ id }) => id === request.id)
                ?.rotationDelta !== request.rotationDelta
            )
              return;
            this.publish({
              ...this.snapshot,
              thumbnails: { ...this.snapshot.thumbnails, [request.id]: status },
            });
            if (status === "ready")
              void opened.preview.geometry(request.sourcePageNumber).then(
                (geometry) => {
                  if (generation === this.generation)
                    this.publish({
                      ...this.snapshot,
                      geometry: {
                        ...this.snapshot.geometry,
                        [request.id]: geometry,
                      },
                    });
                },
                () => {
                  /* Rendering already exposes a safe page status. */
                },
              );
          },
        })),
    );
  }
  cancelExport = () => this.exportAbort?.abort();
  export() {
    return this.exportPlan(this.snapshot.plan);
  }
  exportExtracted() {
    try {
      return this.exportPlan(
        this.snapshot.plan
          ? extractPages(this.snapshot.plan, this.snapshot.selected)
          : undefined,
      );
    } catch {
      this.publish({
        ...this.snapshot,
        error: "INVALID_PLAN",
        announcement: "Select at least one page to extract.",
      });
      return Promise.resolve();
    }
  }
  exportRemaining() {
    try {
      return this.exportPlan(
        this.snapshot.plan
          ? deletePages(this.snapshot.plan, this.snapshot.selected)
          : undefined,
      );
    } catch {
      this.publish({
        ...this.snapshot,
        error: "INVALID_PLAN",
        announcement: "At least one page must remain.",
      });
      return Promise.resolve();
    }
  }
  private async exportPlan(plan?: PagePlan) {
    if (
      !plan ||
      !this.file ||
      !this.opened ||
      this.snapshot.state === "exporting"
    )
      return;
    this.clearResult();
    const generation = this.generation,
      opened = this.opened;
    const input = {
      id: plan.sessionId,
      blob: this.file.slice(0, this.file.size, this.file.type),
    };
    const controller = new AbortController();
    this.exportAbort = controller;
    this.publish({
      ...this.snapshot,
      state: "exporting",
      result: undefined,
      error: undefined,
      announcement: "Preparing local page export.",
    });
    try {
      await opened.scheduler.pause();
      if (controller.signal.aborted || generation !== this.generation)
        throw new PageError("CANCELLED");
      const result = await this.services.transform(input, plan, {
        signal: controller.signal,
        onPhase: (phase) => {
          if (generation === this.generation)
            this.publish({ ...this.snapshot, phase });
        },
      });
      if (controller.signal.aborted || generation !== this.generation) return;
      const url = this.services.createUrl(result.blob);
      this.publish({
        ...this.snapshot,
        state: "result",
        result: { url, pageCount: result.pageCount },
        announcement: "Validated PDF ready to download.",
      });
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          ...this.snapshot,
          state: "ready",
          error: error instanceof PageError ? error.code : "OPERATION_FAILED",
          announcement: "Export did not finish. No new download was created.",
        });
    } finally {
      if (generation === this.generation) {
        this.exportAbort = undefined;
        opened.scheduler.resume();
      }
    }
  }
  stats() {
    return this.opened?.scheduler.stats();
  }
}
