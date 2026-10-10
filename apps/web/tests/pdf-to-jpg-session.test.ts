import { expect, it, vi } from "vitest";
import {
  ThumbnailScheduler,
  type PreviewDocument,
} from "@document-platform/pdf-browser/preview";
import type { PdfToJpegOptions } from "@document-platform/pdf-browser/pdf-to-jpg";
import { PreviewSession } from "../components/pdf-preview/preview-session";

const limits = {
  maxSelectedPages: 50,
  maxPixelsPerPage: 25_000_000,
  maxAggregatePixels: 220_000_000,
  maxCanvasBytes: 100_000_000,
  maxCombinedOutputBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
};

function source() {
  return new File(["%PDF-local"], "sensitive-name.pdf", {
    type: "application/pdf",
  });
}

function opened() {
  const preview: PreviewDocument = {
    sessionId: "jpeg-session",
    pageCount: 2,
    geometry: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
  return { preview, scheduler: new ThumbnailScheduler(preview) };
}

it("publishes one atomic JPG result from the existing preview document", async () => {
  const resources = opened();
  const createUrl = vi.fn(() => "blob:jpeg-result");
  const rasterize = vi.fn(async () => ({
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    kind: "jpg" as const,
    fileCount: 1,
    combinedJpegBytes: 4,
    pages: [
      {
        sourcePageNumber: 2,
        filename: "page-002.jpg",
        width: 100,
        height: 200,
        bytes: 4,
      },
    ],
  }));
  const session = new PreviewSession({
    id: () => "jpeg-session",
    open: async () => resources,
    rasterize,
    createUrl,
  });
  await session.setSource(source());
  const selected = session.getSnapshot().plan!.pages[1].id;
  await session.exportJpeg([selected], 150, limits);
  expect(rasterize).toHaveBeenCalledWith(
    resources.preview,
    session.getSnapshot().plan,
    limits,
    expect.objectContaining({ dpi: 150, selectedIds: [selected] }),
  );
  expect(createUrl).toHaveBeenCalledOnce();
  expect(session.getSnapshot().result).toMatchObject({
    kind: "jpg",
    fileCount: 1,
    dpi: 150,
    url: "blob:jpeg-result",
  });
  await session.destroy();
});

it("aborts a reset export and never publishes a partial URL", async () => {
  const resources = opened();
  let options!: PdfToJpegOptions;
  const rasterize = vi.fn(
    async (
      _preview: PreviewDocument,
      _plan: unknown,
      _limits: unknown,
      received: PdfToJpegOptions,
    ) => {
      options = received;
      await new Promise<void>((resolve) =>
        received.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      throw new DOMException("cancelled", "AbortError");
    },
  );
  const createUrl = vi.fn();
  const session = new PreviewSession({
    id: () => "jpeg-session",
    open: async () => resources,
    rasterize,
    createUrl,
  });
  await session.setSource(source());
  const exporting = session.exportJpeg("all", 300, limits);
  await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
  await session.reset();
  await exporting;
  expect(options.signal?.aborted).toBe(true);
  expect(createUrl).not.toHaveBeenCalled();
  expect(session.getSnapshot().state).toBe("empty");
});
