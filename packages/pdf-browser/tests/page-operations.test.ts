import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  createPagePlan,
  deletePages,
  extractPages,
  reorderPages,
  rotatePages,
  validatePagePlan,
} from "../src/page-model";
import { transformPages } from "../src/page-operations";
import { pageLimits } from "../src/page-types";
import {
  fixtureBytes,
  fixtureRoot,
  inspectPages,
} from "./helpers/pdf-assertions";

const manifest = JSON.parse(
  readFileSync(new URL("preview-manifest.json", fixtureRoot), "utf8"),
);
const original = fixtureBytes("preview-features.pdf");
const input = {
  id: "session-test",
  blob: new Blob([original], { type: "application/pdf" }),
};
const plan = createPagePlan(4, input.id);
const [p1, p2, p3, p4] = plan.pages.map(({ id }) => id);
const ordered = reorderPages(plan, [p4, p2, p1, p3]);
afterEach(() => vi.restoreAllMocks());

describe("M2B stable identity and page planning", () => {
  it("keeps source identities, selection and deltas through reorder without mutation", () => {
    const selected = new Set([p1, p4]);
    const rotated = rotatePages(ordered, [...selected], 90);
    expect(
      rotated.pages.map(({ sourcePageNumber }) => sourcePageNumber),
    ).toEqual([4, 2, 1, 3]);
    expect(
      rotated.pages
        .filter(({ id }) => selected.has(id))
        .map(({ rotationDelta }) => rotationDelta),
    ).toEqual([90, 90]);
    expect(plan.pages.map(({ rotationDelta }) => rotationDelta)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(
      rotatePages(rotated, "all", -90).pages.map(
        ({ rotationDelta }) => rotationDelta,
      ),
    ).toEqual([0, 270, 0, 270]);
    expect(Object.isFrozen(rotated.pages[0])).toBe(true);
    expect(createPagePlan(4).sessionId).not.toBe(createPagePlan(4).sessionId);
  });
  it.each([
    { ids: [p1, p1, p3, p4] },
    { ids: [p1, p2] },
    { ids: [p1, p2, p3, "foreign:4"] },
  ])("rejects invalid permutations", ({ ids }) => {
    expect(() => reorderPages(plan, ids)).toThrow("INVALID_PLAN");
  });
  it("rejects empty/foreign/duplicate selection and deleting all pages", () => {
    for (const ids of [[], ["foreign"], [p1, p1]]) {
      expect(() => extractPages(plan, ids)).toThrow("INVALID_PLAN");
      expect(() => deletePages(plan, ids)).toThrow("INVALID_PLAN");
      expect(() => rotatePages(plan, ids, 90)).toThrow("INVALID_PLAN");
    }
    expect(() =>
      deletePages(
        plan,
        plan.pages.map(({ id }) => id),
      ),
    ).toThrow("INVALID_PLAN");
    expect(() => rotatePages(plan, "all", 45)).toThrow("INVALID_PLAN");
    expect(() =>
      validatePagePlan({
        ...plan,
        pages: [{ ...plan.pages[0], sourcePageNumber: 3 }],
      }),
    ).toThrow("INVALID_PLAN");
  });
});

describe("FR-ORG/EXT/DEL/ROT: validated structural outputs", () => {
  it.each([
    ["reorder", ordered],
    ["extractAfterReorder", extractPages(ordered, [p1, p4])],
    ["deleteAfterReorder", deletePages(ordered, [p1, p4])],
  ] as const)(
    "preserves exact independent %s order, crop and source bytes",
    async (name, operation) => {
      const result = await transformPages(input, operation, pageLimits);
      const inspected = await inspectPages(await result.blob.arrayBuffer());
      expect(inspected.map(({ marker }) => marker)).toEqual(
        manifest.expectedOrders[name],
      );
      const document = await PDFDocument.load(await result.blob.arrayBuffer());
      for (const [index, page] of document.getPages().entries()) {
        const expected =
          manifest.pages[operation.pages[index].sourcePageNumber - 1];
        expect(page.getMediaBox()).toEqual({
          x: 0,
          y: 0,
          width: expected.width,
          height: expected.height,
        });
        expect(page.getCropBox()).toEqual({
          x: expected.crop[0],
          y: expected.crop[1],
          width: expected.crop[2] - expected.crop[0],
          height: expected.crop[3] - expected.crop[1],
        });
        expect(page.getRotation().angle).toBe(expected.rotation);
      }
      expect(
        createHash("sha256")
          .update(new Uint8Array(await input.blob.arrayBuffer()))
          .digest("hex"),
      ).toBe(manifest.sha256);
    },
  );
  it("composes intrinsic rotation after reorder, selected and all rotations", async () => {
    const operation = rotatePages(
      rotatePages(ordered, [p4, p1], 90),
      "all",
      180,
    );
    const result = await transformPages(input, operation, pageLimits);
    expect(
      (await inspectPages(await result.blob.arrayBuffer())).map(
        ({ rotation }) => rotation,
      ),
    ).toEqual([0, 180, 270, 180]);
  });
  it("rejects source mismatch, corrupt/encrypted input and limits atomically", async () => {
    await expect(
      transformPages({ ...input, id: "new-session" }, plan, pageLimits),
    ).rejects.toThrow("INVALID_PLAN");
    await expect(
      transformPages(input, createPagePlan(3, input.id), pageLimits),
    ).rejects.toThrow("INVALID_PLAN");
    await expect(
      transformPages(
        { ...input, blob: new Blob(["%PDF-broken"]) },
        plan,
        pageLimits,
      ),
    ).rejects.toThrow("INVALID_PDF");
    await expect(
      transformPages(
        { ...input, blob: new Blob([fixtureBytes("encrypted.pdf")]) },
        plan,
        pageLimits,
      ),
    ).rejects.toThrow("ENCRYPTED_PDF");
    await expect(
      transformPages(input, plan, { ...pageLimits, maxPages: 3 }),
    ).rejects.toThrow("PAGE_LIMIT");
    await expect(
      transformPages(input, plan, { ...pageLimits, maxInputBytes: 1 }),
    ).rejects.toThrow("INPUT_LIMIT");
    await expect(
      transformPages(input, plan, { ...pageLimits, maxOutputBytes: 1 }),
    ).rejects.toThrow("OUTPUT_LIMIT");
  });
  it("does not return a Blob after cancellation or an invalid reopened output", async () => {
    const abort = new AbortController();
    await expect(
      transformPages(input, plan, pageLimits, {
        signal: abort.signal,
        onPhase: (phase) => {
          if (phase === "validating") abort.abort();
        },
      }),
    ).rejects.toThrow("CANCELLED");
    const source = await PDFDocument.load(original);
    const empty = await PDFDocument.create();
    vi.spyOn(PDFDocument, "load")
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(empty);
    await expect(transformPages(input, plan, pageLimits)).rejects.toThrow(
      "OUTPUT_INVALID",
    );
  });
});
