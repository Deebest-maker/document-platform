import { PageError } from "../page-errors";
import { normalizeRotation, type PageGeometry } from "../page-model";
import { readPageInput } from "../page-validation";
import { pageLimits, type PageInput, type PageLimits } from "../page-types";
import { thumbnailLimits } from "./limits";
import type {
  JpegRenderOptions,
  JpegRenderResult,
  PreviewDocument,
  PreviewOptions,
  ThumbnailSize,
} from "./types";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";

export type {
  JpegRenderOptions,
  JpegRenderResult,
  PreviewDocument,
  PreviewOptions,
  ThumbnailSize,
} from "./types";
export { thumbnailLimits } from "./limits";
export { PageError } from "../page-errors";
export { ThumbnailScheduler } from "./render-scheduler";
export type { ThumbnailRequest, ThumbnailStatus } from "./render-scheduler";

export async function openPreview(
  input: PageInput,
  limits: PageLimits = pageLimits,
  options: PreviewOptions = {},
): Promise<PreviewDocument> {
  const check = () => {
    if (options.signal?.aborted) throw new PageError("CANCELLED");
  };
  check();
  const data = await readPageInput(input, limits);
  check();
  const { getDocument, PDFWorker } = await import("pdfjs-dist");
  check();
  let nativeWorker: Worker;
  try {
    nativeWorker = new Worker(new URL("./pdfjs.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    throw new PageError("WORKER_UNAVAILABLE");
  }
  let worker: InstanceType<typeof PDFWorker> | undefined;
  let loading: PDFDocumentLoadingTask | undefined;
  let document: PDFDocumentProxy | undefined;
  let closing = false;
  let cleanup: Promise<void> | undefined;
  const jobs = new Map<AbortController, Promise<void>>();
  const rendering = new Set<RenderTask>();
  const busyPages = new Set<number>();
  const geometryCache = new Map<number, PageGeometry>();
  const abort = () => {
    void destroy();
  };
  function destroy(): Promise<void> {
    if (cleanup) return cleanup;
    closing = true;
    options.signal?.removeEventListener("abort", abort);
    for (const controller of jobs.keys()) controller.abort();
    cleanup = (async () => {
      // All renders must settle before the loading task releases its document.
      await Promise.allSettled([...rendering].map((task) => task.promise));
      try {
        await loading?.destroy();
      } catch {
        /* Never expose dependency diagnostics during teardown. */
      } finally {
        try {
          worker?.destroy();
        } finally {
          nativeWorker.terminate();
          document = undefined;
          geometryCache.clear();
          busyPages.clear();
        }
      }
      await Promise.allSettled([...jobs.values()]);
    })();
    return cleanup;
  }
  const live = () => {
    if (closing || options.signal?.aborted) throw new PageError("CANCELLED");
    if (!document) throw new PageError("PREVIEW_FAILED");
    return document;
  };
  try {
    worker = PDFWorker.create({ port: nativeWorker, verbosity: 0 });
    const base = "/vendor/pdfjs/6.3.289/";
    loading = getDocument({
      data,
      worker,
      verbosity: 0,
      stopAtErrors: true,
      enableXfa: false,
      useSystemFonts: false,
      disableFontFace: true,
      cMapUrl: base + "cmaps/",
      standardFontDataUrl: base + "standard_fonts/",
      wasmUrl: base + "wasm/",
      iccUrl: base + "iccs/",
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    document = await loading.promise;
    live();
    if (document.numPages < 1) throw new PageError("INVALID_PDF");
    if (document.numPages > limits.maxPages) throw new PageError("PAGE_LIMIT");
  } catch (error) {
    const code =
      error instanceof PageError
        ? error.code
        : options.signal?.aborted
          ? "CANCELLED"
          : error instanceof Error && error.name === "PasswordException"
            ? "ENCRYPTED_PDF"
            : "INVALID_PDF";
    await destroy();
    throw new PageError(code);
  }

  const validPage = (number: number) => {
    const doc = live();
    if (!Number.isSafeInteger(number) || number < 1 || number > doc.numPages)
      throw new PageError("INVALID_PLAN");
    return doc;
  };
  function describe(page: PDFPageProxy): PageGeometry {
    const viewport = page.getViewport({ scale: 1 });
    return Object.freeze({
      sourcePageNumber: page.pageNumber,
      crop: Object.freeze([...page.view]),
      width: viewport.width,
      height: viewport.height,
      originalRotation: page.rotate,
    });
  }
  async function geometry(number: number): Promise<PageGeometry> {
    const doc = validPage(number);
    const cached = geometryCache.get(number);
    if (cached) return cached;
    let page: PDFPageProxy | undefined;
    try {
      page = await doc.getPage(number);
      live();
      const result = describe(page);
      geometryCache.set(number, result);
      return result;
    } catch {
      throw new PageError(closing ? "CANCELLED" : "PREVIEW_FAILED");
    } finally {
      if (page && !busyPages.has(number)) page.cleanup();
    }
  }
  function render(
    number: number,
    canvas: HTMLCanvasElement,
    delta: number,
    size: ThumbnailSize,
    signal?: AbortSignal,
  ): Promise<void> {
    const controller = new AbortController();
    const abortRender = () => controller.abort();
    signal?.addEventListener("abort", abortRender, { once: true });
    if (signal?.aborted) controller.abort();
    let task: RenderTask | undefined;
    const cancelTask = () => task?.cancel();
    controller.signal.addEventListener("abort", cancelTask);
    const pending = (async () => {
      let page: PDFPageProxy | undefined;
      let ownsPage = false;
      try {
        const doc = validPage(number);
        if (controller.signal.aborted) throw new PageError("CANCELLED");
        if (
          busyPages.has(number) ||
          ![0, 90, 180, 270].includes(delta) ||
          Object.values(size).some(
            (value) => !Number.isFinite(value) || value <= 0,
          )
        )
          throw new PageError("RENDER_FAILED");
        busyPages.add(number);
        ownsPage = true;
        page = await doc.getPage(number);
        live();
        if (controller.signal.aborted) throw new PageError("CANCELLED");
        const view = page.getViewport({
          scale: 1,
          rotation: normalizeRotation(page.rotate + delta),
        });
        if (
          !Number.isFinite(view.width) ||
          !Number.isFinite(view.height) ||
          view.width <= 0 ||
          view.height <= 0
        )
          throw new PageError("RENDER_FAILED");
        geometryCache.set(number, describe(page));
        const scale = Math.min(size.width, thumbnailLimits.width) / view.width;
        const fit =
          Math.min(
            scale,
            Math.min(size.height, thumbnailLimits.height) / view.height,
          ) * Math.min(size.dpr, thumbnailLimits.maxDpr);
        const viewport = page.getViewport({
          scale: fit,
          rotation: normalizeRotation(page.rotate + delta),
        });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        if (canvas.width * canvas.height > thumbnailLimits.maxPixels)
          throw new PageError("RENDER_FAILED");
        task = page.render({ canvas, viewport });
        rendering.add(task);
        await task.promise;
        live();
        if (controller.signal.aborted) throw new PageError("CANCELLED");
      } catch {
        canvas.width = canvas.height = 0;
        throw new PageError(
          controller.signal.aborted || closing ? "CANCELLED" : "RENDER_FAILED",
        );
      } finally {
        // task.promise has settled (including cancellation) before cleanup/reuse.
        controller.signal.removeEventListener("abort", cancelTask);
        signal?.removeEventListener("abort", abortRender);
        if (task) rendering.delete(task);
        if (ownsPage) {
          busyPages.delete(number);
          page?.cleanup();
        }
      }
    })();
    jobs.set(controller, pending);
    void pending.then(
      () => jobs.delete(controller),
      () => jobs.delete(controller),
    );
    return pending;
  }
  function renderJpeg(
    number: number,
    jpeg: JpegRenderOptions,
  ): Promise<JpegRenderResult> {
    const controller = new AbortController();
    const abortRender = () => controller.abort();
    jpeg.signal?.addEventListener("abort", abortRender, { once: true });
    if (jpeg.signal?.aborted) controller.abort();
    let task: RenderTask | undefined;
    const cancelTask = () => task?.cancel();
    controller.signal.addEventListener("abort", cancelTask);
    const pending = (async () => {
      let page: PDFPageProxy | undefined;
      let canvas: HTMLCanvasElement | undefined;
      let ownsPage = false;
      try {
        const doc = validPage(number);
        if (
          controller.signal.aborted ||
          ![96, 150, 300].includes(jpeg.dpi) ||
          !Number.isFinite(jpeg.quality) ||
          jpeg.quality <= 0 ||
          jpeg.quality > 1 ||
          !Number.isSafeInteger(jpeg.maxPixels) ||
          jpeg.maxPixels < 1 ||
          !Number.isSafeInteger(jpeg.maxCanvasBytes) ||
          jpeg.maxCanvasBytes < 4 ||
          busyPages.has(number)
        )
          throw new PageError("RENDER_FAILED");
        busyPages.add(number);
        ownsPage = true;
        page = await doc.getPage(number);
        live();
        if (controller.signal.aborted) throw new PageError("CANCELLED");
        const viewport = page.getViewport({ scale: jpeg.dpi / 72 });
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        const pixels = width * height;
        if (
          !Number.isSafeInteger(pixels) ||
          pixels > jpeg.maxPixels ||
          pixels * 4 > jpeg.maxCanvasBytes
        )
          throw new PageError("OUTPUT_LIMIT");
        canvas = window.document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        task = page.render({ canvas, viewport, background: "#ffffff" });
        rendering.add(task);
        await task.promise;
        live();
        if (controller.signal.aborted) throw new PageError("CANCELLED");
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas!.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("encode"))),
            "image/jpeg",
            jpeg.quality,
          ),
        );
        if (controller.signal.aborted) throw new PageError("CANCELLED");
        return { blob, width, height };
      } catch (error) {
        if (error instanceof PageError) throw error;
        throw new PageError(
          controller.signal.aborted || closing ? "CANCELLED" : "RENDER_FAILED",
        );
      } finally {
        controller.signal.removeEventListener("abort", cancelTask);
        jpeg.signal?.removeEventListener("abort", abortRender);
        if (task) rendering.delete(task);
        if (canvas) canvas.width = canvas.height = 0;
        if (ownsPage) {
          busyPages.delete(number);
          page?.cleanup();
        }
      }
    })();
    jobs.set(
      controller,
      pending.then(
        () => undefined,
        () => undefined,
      ),
    );
    void pending.then(
      () => jobs.delete(controller),
      () => jobs.delete(controller),
    );
    return pending;
  }
  return Object.freeze({
    sessionId: input.id,
    pageCount: document!.numPages,
    geometry,
    render,
    renderJpeg,
    destroy,
  });
}
