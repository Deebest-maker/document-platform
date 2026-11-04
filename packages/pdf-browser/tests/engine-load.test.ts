import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEngineModule } from "../src/page-errors";
import { createPagePlan } from "../src/page-model";
import { planSplitRangeGroups, splitLimits } from "../src/split-plan";
import { pageLimits } from "../src/page-types";
import { fixtureBytes } from "./helpers/pdf-assertions";

// M7H (ADR-038). A dynamic import() that cannot be fetched (a connection that
// dropped after the page loaded) must surface as ENGINE_LOAD_FAILED, never as a
// verdict on the document. Each test makes one module's import throw, the way a
// failed chunk request does, and runs the real code that imports it.

const failing = (name: string) => () => {
  throw new Error(`Loading chunk for ${name} failed.`);
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("pdfjs-dist");
  vi.doUnmock("pdf-lib");
  vi.doUnmock("fflate");
  vi.resetModules();
});

describe("loadEngineModule", () => {
  it("passes a loaded module through", async () => {
    await expect(loadEngineModule(async () => ({ ok: 1 }))).resolves.toEqual({
      ok: 1,
    });
  });

  it("turns a rejected import into ENGINE_LOAD_FAILED without keeping the cause", async () => {
    const error = await loadEngineModule(async () => {
      throw new Error("Loading chunk 42 failed: https://example.test/c.js");
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "PageError",
      code: "ENGINE_LOAD_FAILED",
      message: "ENGINE_LOAD_FAILED",
    });
    expect(JSON.stringify(error)).not.toContain("example.test");
  });
});

describe("a tool whose code cannot load blames the connection, not the file", () => {
  it("PDF preview: pdfjs-dist", async () => {
    vi.resetModules();
    vi.doMock("pdfjs-dist", failing("pdfjs-dist"));
    const { openPreview } = await import("../src/preview");
    await expect(
      openPreview({
        id: "load-failure",
        blob: new Blob([fixtureBytes("preview-features.pdf")], {
          type: "application/pdf",
        }),
      }),
    ).rejects.toMatchObject({ code: "ENGINE_LOAD_FAILED" });
  });

  it("Remove Metadata: pdf-lib", async () => {
    vi.resetModules();
    vi.doMock("pdf-lib", failing("pdf-lib"));
    const { removePdfMetadata } = await import("../src/metadata-removal");
    await expect(
      removePdfMetadata({
        id: "load-failure",
        blob: new Blob([fixtureBytes("preview-features.pdf")], {
          type: "application/pdf",
        }),
      }),
    ).rejects.toMatchObject({ code: "ENGINE_LOAD_FAILED" });
  });

  it("Split into several files: fflate", async () => {
    vi.resetModules();
    vi.doMock("fflate", failing("fflate"));
    const { splitPdf } = await import("../src/split-operations");
    const input = {
      id: "load-failure",
      blob: new Blob([fixtureBytes("preview-features.pdf")], {
        type: "application/pdf",
      }),
    };
    const groups = planSplitRangeGroups(createPagePlan(4, input.id), [
      "1-2",
      "3-4",
    ]);
    await expect(
      splitPdf(input, groups, pageLimits, splitLimits),
    ).rejects.toMatchObject({ code: "ENGINE_LOAD_FAILED" });
  });

  it("PDF to JPG, several pages: fflate", async () => {
    vi.resetModules();
    vi.doMock("fflate", failing("fflate"));
    const { renderPdfPagesToJpeg } = await import("../src/pdf-to-jpg");
    const jpeg = new Blob(
      [
        new Uint8Array([
          0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10,
          0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
        ]),
      ],
      { type: "image/jpeg" },
    );
    const preview = {
      sessionId: "load-failure",
      pageCount: 2,
      geometry: vi.fn(async (sourcePageNumber: number) => ({
        sourcePageNumber,
        crop: [0, 0, 612, 792] as const,
        width: 612,
        height: 792,
        originalRotation: 0,
      })),
      render: vi.fn(async () => undefined),
      renderJpeg: vi.fn(async () => ({ blob: jpeg, width: 16, height: 16 })),
      destroy: vi.fn(async () => undefined),
    };
    const plan = createPagePlan(2, "load-failure");
    await expect(
      renderPdfPagesToJpeg(
        preview,
        plan,
        {
          maxSelectedPages: 50,
          maxPixelsPerPage: 25_000_000,
          maxAggregatePixels: 220_000_000,
          maxCanvasBytes: 100_000_000,
          maxCombinedOutputBytes: 64 * 1024 * 1024,
          maxArchiveBytes: 64 * 1024 * 1024,
        },
        { dpi: 96, selectedIds: plan.pages.map(({ id }) => id) },
      ),
    ).rejects.toMatchObject({ code: "ENGINE_LOAD_FAILED" });
  });
});

describe("a preview worker that does not start", () => {
  async function openWithStuckWorker() {
    vi.resetModules();
    const listeners: Record<string, Array<() => void>> = {};
    class StuckWorker {
      terminate = vi.fn();
      addEventListener(type: string, listener: () => void) {
        (listeners[type] ??= []).push(listener);
      }
    }
    vi.stubGlobal("Worker", StuckWorker);
    // pdf.js waits on its worker for ever when the worker's script never loads.
    vi.doMock("pdfjs-dist", () => ({
      PDFWorker: { create: () => ({ destroy: vi.fn() }) },
      getDocument: () => ({
        promise: new Promise(() => undefined),
        // A worker that never started never answers the teardown request either.
        destroy: () => new Promise(() => undefined),
      }),
    }));
    const { openPreview } = await import("../src/preview");
    const pending = openPreview({
      id: "stuck",
      blob: new Blob([fixtureBytes("preview-features.pdf")], {
        type: "application/pdf",
      }),
    });
    await vi.waitFor(() => expect(listeners.error).toBeDefined());
    return { pending, listeners };
  }

  it("ends the open as a load failure when the worker was silent", async () => {
    const { pending, listeners } = await openWithStuckWorker();
    listeners.error[0]();
    await expect(pending).rejects.toMatchObject({
      code: "ENGINE_LOAD_FAILED",
    });
  });

  it("ends the open as a preview failure when the worker had spoken", async () => {
    const { pending, listeners } = await openWithStuckWorker();
    listeners.message[0]();
    listeners.error[0]();
    await expect(pending).rejects.toMatchObject({ code: "PREVIEW_FAILED" });
  });
});
