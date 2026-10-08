import { describe, expect, it, vi } from "vitest";
import type {
  ImageInspection,
  ImageLimits,
} from "@document-platform/pdf-browser/image-types";
import { ImagesToPdfSession } from "../components/images-to-pdf/session";

const limits: ImageLimits = {
  maxFiles: 20,
  maxFileBytes: 1024,
  maxTotalBytes: 4096,
  maxPages: 20,
  maxOutputBytes: 4096,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixelsPerImage: 24_000_000,
  maxAggregatePixels: 160_000_000,
  maxDecodedBytesPerImage: 96_000_000,
  maxAggregateDecodedBytes: 640_000_000,
};
const inspection: ImageInspection = {
  mime: "image/jpeg",
  width: 1200,
  height: 800,
  orientation: 1,
  displayWidth: 1200,
  displayHeight: 800,
  pixels: 960_000,
  estimatedRgbaBytes: 3_840_000,
};

function image(name: string, type = "image/jpeg") {
  return new File([Uint8Array.of(1, 2, 3)], name, { type });
}

function harness() {
  let id = 0;
  let previewId = 0;
  const revoked: string[] = [];
  const engine = vi.fn(async () => ({
    blob: new Blob(["pdf"], { type: "application/pdf" }),
    pageCount: 3,
    outputBytes: 3,
  }));
  const session = new ImagesToPdfSession(limits, {
    id: () => `image-${++id}`,
    inspect: async () => inspection,
    preview: async () => new Blob(["preview"], { type: "image/jpeg" }),
    createUrl: (blob) =>
      blob.type === "application/pdf"
        ? "blob:result"
        : `blob:preview-${++previewId}`,
    revokeUrl: (url) => revoked.push(url),
    load: async () => ({ imagesToPdf: engine }),
  });
  return { session, engine, revoked };
}

describe("ImagesToPdfSession", () => {
  it("keeps stable image identity through C A B reorder and sends that exact order", async () => {
    const { session, engine } = harness();
    await session.add([image("A.jpg"), image("B.jpg"), image("C.jpg")]);
    const [a, , c] = session.getSnapshot().rows;
    session.move(c.id, -1);
    session.move(c.id, -1);
    expect(session.getSnapshot().rows.map((row) => row.file.name)).toEqual([
      "C.jpg",
      "A.jpg",
      "B.jpg",
    ]);
    expect(session.getSnapshot().rows[1].id).toBe(a.id);
    session.setOptions({
      pageSize: "letter",
      fit: "cover",
      orientation: "landscape",
    });
    await session.generate();
    expect(engine).toHaveBeenCalledOnce();
    const call = engine.mock.calls[0] as unknown as [
      Array<{ id: string }>,
      ImageLimits,
      { pageSize: string; fit: string; orientation: string },
    ];
    expect(call[0].map((entry) => entry.id)).toEqual([
      "image-3",
      "image-1",
      "image-2",
    ]);
    expect(call[2]).toMatchObject({
      pageSize: "letter",
      fit: "cover",
      orientation: "landscape",
    });
  });

  it("rejects declared type/extension disagreement before inspection", async () => {
    const { session } = harness();
    await session.add([image("wrong.png", "image/jpeg")]);
    expect(session.getSnapshot().rows[0]).toMatchObject({
      status: "error",
      error: "UNSUPPORTED_TYPE",
    });
  });

  it("releases removed previews and all remaining preview/result URLs on reset", async () => {
    const { session, revoked } = harness();
    await session.add([image("A.jpg"), image("B.jpg")]);
    session.remove("image-1");
    expect(revoked).toEqual(["blob:preview-1"]);
    await session.generate();
    session.reset();
    expect(revoked).toEqual([
      "blob:preview-1",
      "blob:result",
      "blob:preview-2",
    ]);
    expect(session.getSnapshot().state).toBe("idle");
  });

  it("cancels generation and ignores a stale successful completion", async () => {
    let resolveEngine!: (value: {
      blob: Blob;
      pageCount: number;
      outputBytes: number;
    }) => void;
    const engine = vi.fn(
      () =>
        new Promise<{
          blob: Blob;
          pageCount: number;
          outputBytes: number;
        }>((resolve) => {
          resolveEngine = resolve;
        }),
    );
    const revoked: string[] = [];
    const session = new ImagesToPdfSession(limits, {
      id: () => "image-1",
      inspect: async () => inspection,
      preview: async () => new Blob(["preview"], { type: "image/jpeg" }),
      createUrl: (blob) =>
        blob.type === "application/pdf" ? "blob:stale" : "blob:preview",
      revokeUrl: (url) => revoked.push(url),
      load: async () => ({ imagesToPdf: engine }),
    });
    await session.add([image("A.jpg")]);
    const pending = session.generate();
    await vi.waitFor(() => expect(engine).toHaveBeenCalledOnce());
    session.cancel();
    expect(session.getSnapshot()).toMatchObject({
      state: "ready",
      result: undefined,
    });
    resolveEngine({
      blob: new Blob(["pdf"], { type: "application/pdf" }),
      pageCount: 1,
      outputBytes: 3,
    });
    await pending;
    expect(session.getSnapshot()).toMatchObject({
      state: "ready",
      result: undefined,
    });
    expect(revoked).not.toContain("blob:stale");
  });
});
