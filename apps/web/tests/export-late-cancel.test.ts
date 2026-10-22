import { expect, it, vi } from "vitest";
import {
  ThumbnailScheduler,
  type PreviewDocument,
} from "@document-platform/pdf-browser/preview";
import type { PageInput } from "@document-platform/pdf-browser/pages";
import { PreviewSession } from "../components/pdf-preview/preview-session";

// Cancel is pressed while an engine is finishing and the engine does not stop:
// it still returns a result. The session must report "cancelled", create no
// download and leave the page choices usable. Before M7A it stayed in
// "exporting" with an inert Cancel button, with no way out except reloading.

const splitLimits = {
  maxOutputs: 20,
  maxCombinedPdfBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
};
const jpegLimits = {
  maxSelectedPages: 50,
  maxPixelsPerPage: 25_000_000,
  maxAggregatePixels: 220_000_000,
  maxCanvasBytes: 100_000_000,
  maxCombinedOutputBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
};

const source = () =>
  new File(["%PDF-local"], "name.pdf", { type: "application/pdf" });

function opened() {
  const preview: PreviewDocument = {
    sessionId: "late-cancel",
    pageCount: 2,
    geometry: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
  return { preview, scheduler: new ThumbnailScheduler(preview) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function start(
  services: ConstructorParameters<typeof PreviewSession>[0],
) {
  const createUrl = vi.fn(() => "blob:should-not-exist");
  const session = new PreviewSession({
    id: () => "late-cancel",
    open: async () => opened(),
    createUrl,
    ...services,
  });
  await session.setSource(source());
  return { session, createUrl };
}

function expectCancelledCleanly(
  session: PreviewSession,
  createUrl: ReturnType<typeof vi.fn>,
) {
  const snapshot = session.getSnapshot();
  expect(snapshot.state).toBe("ready");
  expect(snapshot.error).toBe("CANCELLED");
  expect(snapshot.result).toBeUndefined();
  expect(createUrl).not.toHaveBeenCalled();
}

it("a late cancel during a page export ends as cancelled, not stuck", async () => {
  const pending = deferred<{ blob: Blob; pageCount: number }>();
  const transform = vi.fn((input: PageInput) => {
    void input;
    return pending.promise;
  });
  const { session, createUrl } = await start({ transform });
  const exporting = session.export();
  await vi.waitFor(() => expect(transform).toHaveBeenCalled());
  session.cancelExport();
  pending.resolve({ blob: new Blob(["%PDF-out"]), pageCount: 2 });
  await exporting;
  expectCancelledCleanly(session, createUrl);
});

it("a late cancel during a split ends as cancelled, not stuck", async () => {
  const pending = deferred<{
    blob: Blob;
    kind: "pdf";
    fileCount: number;
    pageCount: number;
    combinedPdfBytes: number;
  }>();
  const split = vi.fn(() => pending.promise);
  const { session, createUrl } = await start({ split });
  const plan = session.getSnapshot().plan!;
  const exporting = session.exportSplit([plan], splitLimits);
  await vi.waitFor(() => expect(split).toHaveBeenCalled());
  session.cancelExport();
  pending.resolve({
    blob: new Blob(["%PDF-out"]),
    kind: "pdf",
    fileCount: 1,
    pageCount: 2,
    combinedPdfBytes: 8,
  });
  await exporting;
  expectCancelledCleanly(session, createUrl);
});

it("a late cancel during JPG generation ends as cancelled, not stuck", async () => {
  const pending = deferred<{
    blob: Blob;
    kind: "jpg";
    fileCount: number;
    combinedJpegBytes: number;
    pages: never[];
  }>();
  const rasterize = vi.fn(() => pending.promise);
  const { session, createUrl } = await start({ rasterize });
  const exporting = session.exportJpeg("all", 150, jpegLimits);
  await vi.waitFor(() => expect(rasterize).toHaveBeenCalled());
  session.cancelExport();
  pending.resolve({
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    kind: "jpg",
    fileCount: 1,
    combinedJpegBytes: 4,
    pages: [],
  });
  await exporting;
  expectCancelledCleanly(session, createUrl);
  // The scheduler was paused for the export and must be running again.
  expect(session.stats()?.paused).toBe(false);
});

it("an export that is not cancelled still publishes its result", async () => {
  const transform = vi.fn(async (input: PageInput) => {
    void input;
    return { blob: new Blob(["%PDF-out"]), pageCount: 2 };
  });
  const createUrl = vi.fn(() => "blob:ok");
  const { session } = await start({ transform, createUrl });
  await session.export();
  expect(session.getSnapshot().state).toBe("result");
  expect(createUrl).toHaveBeenCalledTimes(1);
});
