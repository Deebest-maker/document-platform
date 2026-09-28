import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { openPreview } from "../src/preview";
import { pageLimits } from "../src/page-types";
const sdk = vi.hoisted(() => ({ getDocument: vi.fn(), create: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  getDocument: sdk.getDocument,
  PDFWorker: { create: sdk.create },
}));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class NativeWorker {
  static latest: NativeWorker;
  terminate = vi.fn();
  constructor() {
    NativeWorker.latest = this;
  }
}
const input = { id: "preview-session", blob: new Blob(["%PDF-synthetic"]) };
function fixture() {
  const page = {
    pageNumber: 1,
    view: [40, 50, 460, 610],
    rotate: 90,
    cleanup: vi.fn(),
    getViewport: vi.fn(
      ({ scale, rotation = 90 }: { scale: number; rotation?: number }) => ({
        width: (rotation % 180 ? 560 : 420) * scale,
        height: (rotation % 180 ? 420 : 560) * scale,
      }),
    ),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  };
  const document = { numPages: 1, getPage: vi.fn(async () => page) };
  const loading = {
    promise: Promise.resolve(document),
    destroy: vi.fn(async () => {}),
  };
  const worker = { destroy: vi.fn() };
  sdk.create.mockReturnValue(worker);
  sdk.getDocument.mockReturnValue(loading);
  return { page, document, loading, worker };
}
beforeEach(() => {
  vi.stubGlobal("Worker", NativeWorker);
  sdk.create.mockReset();
  sdk.getDocument.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it("uses only explicit first-party assets, a real worker and the verified font configuration", async () => {
  const f = fixture();
  const preview = await openPreview(input);
  expect(sdk.create).toHaveBeenCalledWith({
    port: NativeWorker.latest,
    verbosity: 0,
  });
  expect(sdk.getDocument.mock.calls[0][0]).toMatchObject({
    verbosity: 0,
    enableXfa: false,
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: "/vendor/pdfjs/6.3.289/standard_fonts/",
  });
  expect(await preview.geometry(1)).toEqual({
    sourcePageNumber: 1,
    crop: [40, 50, 460, 610],
    width: 560,
    height: 420,
    originalRotation: 90,
  });
  const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
  await preview.render(1, canvas, 90, { width: 10000, height: 10000, dpr: 10 });
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(307200);
  expect(canvas.height).toBeGreaterThan(canvas.width);
  await preview.destroy();
  await preview.destroy();
  expect(f.loading.destroy).toHaveBeenCalledTimes(1);
  expect(f.worker.destroy).toHaveBeenCalledTimes(1);
  expect(NativeWorker.latest.terminate).toHaveBeenCalledTimes(1);
});
it("cancels and settles active rendering before document cleanup", async () => {
  const f = fixture(),
    work = deferred<void>(),
    cancel = vi.fn();
  f.page.render.mockReturnValue({ promise: work.promise, cancel });
  const preview = await openPreview(input),
    canvas = { width: 0, height: 0 } as HTMLCanvasElement;
  const rendered = preview.render(1, canvas, 0, {
    width: 240,
    height: 320,
    dpr: 2,
  });
  const rejected = expect(rendered).rejects.toThrow("CANCELLED");
  await vi.waitFor(() => expect(f.page.render).toHaveBeenCalled());
  const closed = preview.destroy();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(f.loading.destroy).not.toHaveBeenCalled();
  expect(f.page.cleanup).not.toHaveBeenCalled();
  work.reject(new Error("private dependency detail"));
  await rejected;
  await closed;
  expect(canvas.width).toBe(0);
  expect(f.page.cleanup).toHaveBeenCalledTimes(1);
  expect(f.loading.destroy).toHaveBeenCalledTimes(1);
});
it("cleans up render errors without exposing dependency data", async () => {
  const f = fixture();
  f.page.render.mockImplementation(() => ({
    promise: Promise.reject(new Error("secret text")),
    cancel: vi.fn(),
  }));
  const preview = await openPreview(input),
    canvas = { width: 0, height: 0 } as HTMLCanvasElement;
  await expect(
    preview.render(1, canvas, 0, { width: 240, height: 320, dpr: 1 }),
  ).rejects.toMatchObject({ message: "RENDER_FAILED" });
  expect(canvas.width).toBe(0);
  expect(f.page.cleanup).toHaveBeenCalled();
  await preview.destroy();
});
it("destroys failed loading and rejects page caps before exposing a document", async () => {
  const f = fixture();
  f.document.numPages = 201;
  await expect(openPreview(input, pageLimits)).rejects.toThrow("PAGE_LIMIT");
  expect(NativeWorker.latest.terminate).toHaveBeenCalled();
  const password = Object.assign(new Error("secret password hint"), {
    name: "PasswordException",
  });
  sdk.getDocument.mockReturnValue({
    promise: Promise.reject(password),
    destroy: vi.fn(async () => {}),
  });
  await expect(openPreview(input)).rejects.toThrow("ENCRYPTED_PDF");
  expect(NativeWorker.latest.terminate).toHaveBeenCalled();
});
it("does not create a worker for an already cancelled source", async () => {
  fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(
    openPreview(input, pageLimits, { signal: abort.signal }),
  ).rejects.toThrow("CANCELLED");
  expect(sdk.create).not.toHaveBeenCalled();
});
