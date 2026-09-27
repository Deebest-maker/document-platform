import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { PdfError, type MergeLimits } from "../src";
import { mergePdfs } from "../src/merge";
import {
  fixtureBytes,
  fixtureRoot,
  inspectPages,
} from "./helpers/pdf-assertions";

export const testLimits: MergeLimits = {
  maxFiles: 20,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxPages: 300,
  maxOutputBytes: 32 * 1024 * 1024,
};
const input = (name: string, id = name) => ({
  id,
  blob: new Blob([fixtureBytes(name)], { type: "application/pdf" }),
});
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", fixtureRoot), "utf8"),
) as {
  pages: Record<
    string,
    { marker: string; width: number; height: number; rotation: number }[]
  >;
  expectedOrders: Record<string, string[]>;
  sha256: Record<string, string>;
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("FR-MRG-001/003/004: real PDF Merge", () => {
  it.each([
    ["a+b", ["a.pdf", "b.pdf"]],
    ["b+a", ["b.pdf", "a.pdf"]],
    ["c+b+a", ["c.pdf", "b.pdf", "a.pdf"]],
  ] as const)(
    "preserves independently authored exact order: %s",
    async (order, names) => {
      const inputs = names.map((name) => input(name));
      const originals = await Promise.all(
        inputs.map(async ({ blob }) =>
          hash(new Uint8Array(await blob.arrayBuffer())),
        ),
      );
      const result = await mergePdfs(inputs, testLimits);
      expect(result.blob.type).toBe("application/pdf");
      const pages = await inspectPages(await result.blob.arrayBuffer());
      expect(pages.map((page) => page.marker)).toEqual(
        manifest.expectedOrders[order],
      );
      expect(result.pageCount).toBe(manifest.expectedOrders[order].length);
      expect(result.inputCount).toBe(names.length);
      const byMarker = new Map(
        Object.values(manifest.pages)
          .flat()
          .map((page) => [page.marker, page]),
      );
      for (const page of pages)
        expect(page).toEqual(byMarker.get(page.marker!));
      expect(
        await Promise.all(
          inputs.map(async ({ blob }) =>
            hash(new Uint8Array(await blob.arrayBuffer())),
          ),
        ),
      ).toEqual(originals);
      names.forEach((name, index) =>
        expect(originals[index]).toBe(manifest.sha256[name]),
      );
    },
  );

  it("supports two one-page sources and explicit duplicate selections", async () => {
    const result = await mergePdfs(
      [input("c.pdf", "one"), input("c.pdf", "two"), input("d.pdf")],
      testLimits,
    );
    const pages = await inspectPages(await result.blob.arrayBuffer());
    expect(pages.map(({ marker }) => marker)).toEqual(["C1", "C1", "D1"]);
    expect(pages[2].rotation).toBe(270);
  });

  it.each(["form.pdf", "signed.pdf"])(
    "does not blanket-reject %s",
    async (name) => {
      const source = await PDFDocument.load(fixtureBytes(name));
      expect(source.catalog.has(PDFName.of("AcroForm"))).toBe(true);
      const result = await mergePdfs([input(name), input("c.pdf")], testLimits);
      expect(
        (await inspectPages(await result.blob.arrayBuffer())).map(
          ({ marker }) => marker,
        ),
      ).toEqual([name === "form.pdf" ? "FORM1" : "SIG1", "C1"]);
    },
  );

  it.each([
    ["encrypted.pdf", "ENCRYPTED_PDF"],
    ["corrupt.pdf", "INVALID_PDF"],
    ["truncated.pdf", "INVALID_PDF"],
  ])("fails atomically and safely for %s", async (name, code) => {
    const warn = vi.spyOn(console, "warn");
    const log = vi.spyOn(console, "log");
    try {
      await expect(
        mergePdfs([input("a.pdf"), input(name, "opaque-id")], testLimits),
      ).rejects.toMatchObject({ code, inputId: "opaque-id", message: code });
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it("rejects page/output boundaries without returning partial output", async () => {
    await expect(
      mergePdfs([input("a.pdf"), input("b.pdf")], {
        ...testLimits,
        maxPages: 3,
      }),
    ).rejects.toMatchObject({ code: "PAGE_LIMIT" });
    await expect(
      mergePdfs([input("a.pdf"), input("b.pdf")], {
        ...testLimits,
        maxOutputBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  });

  it("honors cooperative abandonment at a phase boundary", async () => {
    const controller = new AbortController();
    await expect(
      mergePdfs([input("a.pdf"), input("b.pdf")], testLimits, {
        signal: controller.signal,
        onPhase: () => controller.abort(),
      }),
    ).rejects.toBeInstanceOf(PdfError);
    await expect(
      mergePdfs([input("a.pdf"), input("b.pdf")], testLimits, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
