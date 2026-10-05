import { expect, it, vi } from "vitest";
import type { PagePlan } from "@document-platform/pdf-browser/page-model";
import {
  ThumbnailScheduler,
  type PreviewDocument,
} from "@document-platform/pdf-browser/preview";
import type { PageInput } from "@document-platform/pdf-browser/pages";
import { PreviewSession } from "../components/pdf-preview/preview-session";

const source = () =>
  new File(["%PDF-page-tools"], "private-source.pdf", {
    type: "application/pdf",
  });

function services(pageCount = 5) {
  const preview: PreviewDocument = {
    sessionId: "page-tools",
    pageCount,
    geometry: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
  const plans: PagePlan[] = [];
  return {
    preview,
    plans,
    values: {
      id: () => "page-tools",
      open: async () => ({
        preview,
        scheduler: new ThumbnailScheduler(preview),
      }),
      transform: async (input: PageInput, plan: PagePlan) => {
        plans.push(plan);
        return {
          blob: new Blob(["%PDF-result"], { type: "application/pdf" }),
          pageCount: plan.pages.length,
        };
      },
      createUrl: () => `blob:result-${plans.length}`,
    },
  };
}

it("FR-EXT-001: exports selected stable IDs in current order, not click order", async () => {
  const test = services();
  const session = new PreviewSession(test.values);
  const original = source();
  const before = new Uint8Array(await original.arrayBuffer());
  await session.setSource(original);
  const ids = session.getSnapshot().plan!.pages.map(({ id }) => id);
  session.move(ids[2], -1);
  session.move(ids[2], -1);
  session.move(ids[4], -1);
  session.move(ids[4], -1);
  expect(
    session
      .getSnapshot()
      .plan!.pages.map(({ sourcePageNumber }) => sourcePageNumber),
  ).toEqual([3, 1, 5, 2, 4]);
  for (const id of [ids[4], ids[3], ids[0]]) session.select(id, true);
  await session.exportExtracted();
  expect(
    test.plans[0].pages.map(({ sourcePageNumber }) => sourcePageNumber),
  ).toEqual([1, 5, 4]);
  expect(
    session
      .getSnapshot()
      .plan!.pages.map(({ sourcePageNumber }) => sourcePageNumber),
  ).toEqual([3, 1, 5, 2, 4]);
  expect(new Uint8Array(await original.arrayBuffer())).toEqual(before);
  await session.destroy();
});

it("FR-DEL-001: exports the exact complement and blocks deleting every page", async () => {
  const test = services();
  const session = new PreviewSession(test.values);
  await session.setSource(source());
  const ids = session.getSnapshot().plan!.pages.map(({ id }) => id);
  session.select(ids[1], true);
  session.select(ids[3], true);
  await session.exportRemaining();
  expect(
    test.plans[0].pages.map(({ sourcePageNumber }) => sourcePageNumber),
  ).toEqual([1, 3, 5]);
  session.clearSelection();
  session.selectAll();
  await session.exportRemaining();
  expect(test.plans).toHaveLength(1);
  expect(session.getSnapshot().error).toBe("INVALID_PLAN");
  await session.destroy();
});

it("FR-ROT-001/002: composes selected/all left and right quarter turns", async () => {
  const test = services(3);
  const session = new PreviewSession(test.values);
  await session.setSource(source());
  const ids = session.getSnapshot().plan!.pages.map(({ id }) => id);
  session.select(ids[0], true);
  session.rotate(false, 90);
  session.rotate(false, -90);
  session.rotate(false, 90);
  session.rotate(false, 90);
  expect(session.getSnapshot().plan!.pages[0].rotationDelta).toBe(180);
  session.rotate(false, 90);
  session.rotate(false, 90);
  expect(session.getSnapshot().plan!.pages[0].rotationDelta).toBe(0);
  session.clearSelection();
  session.select(ids[2], true);
  session.rotate(false, -90);
  session.rotate(true, 90);
  expect(
    session.getSnapshot().plan!.pages.map(({ rotationDelta }) => rotationDelta),
  ).toEqual([90, 90, 0]);
  await session.export();
  expect(test.plans[0].pages.map(({ rotationDelta }) => rotationDelta)).toEqual(
    [90, 90, 0],
  );
  await session.destroy();
});
