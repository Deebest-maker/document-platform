import { expect, it, vi } from "vitest";
import { PreviewSession } from "../components/pdf-preview/preview-session";
import {
  ThumbnailScheduler,
  type PreviewDocument,
} from "@document-platform/pdf-browser/preview";
import {
  PageError,
  type PageInput,
  type PageOperationOptions,
} from "@document-platform/pdf-browser/pages";
import type {
  SplitOptions,
  SplitResult,
} from "@document-platform/pdf-browser/split";

const splitLimits = {
  maxOutputs: 20,
  maxCombinedPdfBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
};

const file = () =>
  new File(["%PDF-synthetic"], "private-name.pdf", { type: "application/pdf" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function opened(id = "one") {
  const preview: PreviewDocument = {
    sessionId: id,
    pageCount: 4,
    geometry: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
  const scheduler = new ThumbnailScheduler(preview);
  return { preview, scheduler };
}
it("keeps selected identity through reorder, rotates, validates selection, revokes results on edits/reset", async () => {
  const resources = opened(),
    createUrl = vi.fn(() => "blob:test"),
    revokeUrl = vi.fn();
  const transform = vi
    .fn<(input: PageInput) => Promise<{ blob: Blob; pageCount: number }>>()
    .mockResolvedValue({ blob: new Blob(["%PDF-output"]), pageCount: 2 });
  const session = new PreviewSession({
    open: async () => resources,
    transform,
    id: () => "one",
    createUrl,
    revokeUrl,
  });
  await session.setSource(file());
  const ids = session.getSnapshot().plan!.pages.map(({ id }) => id);
  session.select(ids[3], true);
  session.move(ids[3], -1);
  session.rotate();
  expect(session.getSnapshot().selected).toEqual([ids[3]]);
  expect(session.getSnapshot().plan!.pages[2]).toMatchObject({
    id: ids[3],
    sourcePageNumber: 4,
    rotationDelta: 90,
  });
  session.select(ids[0], true);
  session.extract();
  await session.export();
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(transform.mock.calls[0][0].blob).not.toHaveProperty("name");
  session.rotate(true);
  expect(revokeUrl).toHaveBeenCalledWith("blob:test");
  expect(session.getSnapshot().result).toBeUndefined();
  session.delete();
  expect(session.getSnapshot().error).toBe("INVALID_PLAN");
  await session.reset();
  expect(resources.preview.destroy).toHaveBeenCalled();
  expect(session.getSnapshot().plan).toBeUndefined();
});
it("serializes replacement cleanup and cannot publish stale loading results", async () => {
  const pending = deferred<ReturnType<typeof opened>>(),
    first = opened("old"),
    second = opened("new");
  const open = vi
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(second);
  let counter = 0;
  const session = new PreviewSession({
    open,
    id: () => `session-${++counter}`,
  });
  const firstLoad = session.setSource(file());
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  const secondLoad = session.setSource(file());
  expect(open.mock.calls[0][1].aborted).toBe(true);
  expect(open).toHaveBeenCalledTimes(1);
  pending.resolve(first);
  await firstLoad;
  await secondLoad;
  expect(first.preview.destroy).toHaveBeenCalled();
  expect(session.getSnapshot().plan!.sessionId).toBe("session-2");
  await session.destroy();
  expect(second.preview.destroy).toHaveBeenCalled();
});
it("cancels a stale export and creates no URL after reset", async () => {
  const pending = deferred<{ blob: Blob; pageCount: number }>(),
    createUrl = vi.fn(),
    resources = opened();
  const transform = vi
      .fn<
        (
          input: PageInput,
          plan: unknown,
          options: PageOperationOptions,
        ) => typeof pending.promise
      >()
      .mockReturnValue(pending.promise),
    session = new PreviewSession({
      open: async () => resources,
      transform,
      createUrl,
      id: () => "one",
    });
  await session.setSource(file());
  const exporting = session.export();
  await vi.waitFor(() => expect(transform).toHaveBeenCalled());
  expect(resources.scheduler.stats().paused).toBe(true);
  await session.reset();
  expect(transform.mock.calls[0][2].signal!.aborted).toBe(true);
  pending.resolve({ blob: new Blob(["%PDF-result"]), pageCount: 4 });
  await exporting;
  expect(createUrl).not.toHaveBeenCalled();
  expect(session.getSnapshot().state).toBe("empty");
});
it("reports safe failed rendering/loading/export states with no partial download", async () => {
  const session = new PreviewSession({
    open: async () => {
      throw new Error("private parser details");
    },
  });
  await session.setSource(file());
  expect(session.getSnapshot().error).toBe("PREVIEW_FAILED");
  expect(JSON.stringify(session.getSnapshot())).not.toContain("private");
  const working = new PreviewSession({
    open: async () => opened(),
    transform: async () => {
      throw new PageError("OUTPUT_INVALID");
    },
  });
  await working.setSource(file());
  await working.export();
  expect(working.getSnapshot().error).toBe("OUTPUT_INVALID");
  expect(working.getSnapshot().result).toBeUndefined();
  await working.destroy();
});

it("publishes an atomic split result and revokes its URL on reset", async () => {
  const resources = opened(),
    createUrl = vi.fn(() => "blob:split-result"),
    revokeUrl = vi.fn(),
    split = vi.fn(async (input: PageInput): Promise<SplitResult> => {
      expect(input.blob).not.toHaveProperty("name");
      return {
        blob: new Blob(["ZIP"], { type: "application/zip" }),
        kind: "zip",
        fileCount: 2,
        pageCount: 3,
        combinedPdfBytes: 2_048,
      };
    });
  const session = new PreviewSession({
    open: async () => resources,
    split,
    createUrl,
    revokeUrl,
    id: () => "one",
  });
  await session.setSource(file());
  const plan = session.getSnapshot().plan!;
  await session.exportSplit(
    [
      { ...plan, pages: plan.pages.slice(0, 2) },
      { ...plan, pages: plan.pages.slice(2, 3) },
    ],
    splitLimits,
  );
  expect(session.getSnapshot().result).toEqual({
    url: "blob:split-result",
    kind: "zip",
    fileCount: 2,
    pageCount: 3,
    combinedPdfBytes: 2_048,
  });
  await session.reset();
  expect(revokeUrl).toHaveBeenCalledWith("blob:split-result");
});

it("aborts split generation and ignores a stale completion after reset", async () => {
  const pending = deferred<SplitResult>(),
    resources = opened(),
    createUrl = vi.fn(),
    split = vi.fn((...args: [PageInput, unknown, SplitOptions]) => {
      void args;
      return pending.promise;
    });
  const session = new PreviewSession({
    open: async () => resources,
    split,
    createUrl,
    id: () => "one",
  });
  await session.setSource(file());
  const plan = session.getSnapshot().plan!;
  const exporting = session.exportSplit([plan], splitLimits);
  await vi.waitFor(() => expect(split).toHaveBeenCalled());
  expect(resources.scheduler.stats().paused).toBe(true);
  await session.reset();
  expect(split.mock.calls[0][2].signal!.aborted).toBe(true);
  pending.resolve({
    blob: new Blob(["%PDF-result"]),
    kind: "pdf",
    fileCount: 1,
    pageCount: 4,
    combinedPdfBytes: 11,
  });
  await exporting;
  expect(createUrl).not.toHaveBeenCalled();
  expect(session.getSnapshot().state).toBe("empty");
});
