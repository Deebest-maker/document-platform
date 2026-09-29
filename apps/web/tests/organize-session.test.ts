import { expect, it, vi } from "vitest";
import { PreviewSession } from "../components/pdf-preview/preview-session";
import {
  ThumbnailScheduler,
  type PreviewDocument,
} from "@document-platform/pdf-browser/preview";
import type { PageInput } from "@document-platform/pdf-browser/pages";

const source = () =>
  new File(["%PDF-organize"], "private-source.pdf", {
    type: "application/pdf",
  });

it("FR-ORG-002: exports the exact stable-ID order and preserves source bytes", async () => {
  const preview: PreviewDocument = {
    sessionId: "organize",
    pageCount: 4,
    geometry: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
  const transform = vi.fn(
    async (
      input: PageInput,
      plan: { pages: readonly { sourcePageNumber: number }[] },
    ) => ({
      blob: new Blob(["%PDF-result"], { type: "application/pdf" }),
      pageCount: plan.pages.length,
    }),
  );
  const original = source();
  const before = new Uint8Array(await original.arrayBuffer());
  const session = new PreviewSession({
    id: () => "organize",
    open: async () => ({
      preview,
      scheduler: new ThumbnailScheduler(preview),
    }),
    transform,
    createUrl: () => "blob:organized",
  });
  await session.setSource(original);
  const ids = session.getSnapshot().plan!.pages.map(({ id }) => id);
  session.move(ids[0], 1);
  session.move(ids[0], 1);
  session.move(ids[3], -1);
  session.move(ids[3], -1);
  await session.export();
  expect(
    transform.mock.calls[0][1].pages.map(
      ({ sourcePageNumber }) => sourcePageNumber,
    ),
  ).toEqual([2, 4, 3, 1]);
  expect(new Uint8Array(await original.arrayBuffer())).toEqual(before);
  expect(transform.mock.calls[0][0].blob).not.toHaveProperty("name");
  expect(session.getSnapshot().result).toMatchObject({
    url: "blob:organized",
    pageCount: 4,
  });
  await session.destroy();
  expect(preview.destroy).toHaveBeenCalledOnce();
});
