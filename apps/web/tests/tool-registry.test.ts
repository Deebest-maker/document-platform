import { describe, expect, it } from "vitest";
import {
  categories,
  tools,
  processingModes,
  filterTools,
  getTool,
  getToolHref,
  getToolMetadata,
  getToolPath,
  getRelatedTools,
  getPrivacyPresentation,
} from "@document-platform/tool-registry";

describe("DEV-004: authoritative tool registry", () => {
  it("has unique valid slugs without collisions with shell routes", () => {
    expect(tools).toHaveLength(13);
    expect(new Set(tools.map((tool) => tool.slug)).size).toBe(tools.length);
    const reserved = ["tools", "about", "privacy", "terms", "contact", "learn"];
    for (const tool of tools) {
      expect(tool.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(reserved).not.toContain(tool.slug);
      expect(tool.title.trim()).not.toBe("");
      expect(tool.description.trim()).not.toBe("");
    }
  });

  it("uses valid categories, modes, accepted types, and related references", () => {
    const categoryIds = categories.map((category) => category.id);
    for (const tool of tools) {
      expect(categoryIds).toContain(tool.category);
      expect(processingModes).toContain(tool.processingMode);
      expect(["planned", "preview", "available"]).toContain(tool.availability);
      expect(tool.acceptedTypes.length).toBeGreaterThan(0);
      for (const type of tool.acceptedTypes) {
        expect(type.mime).toContain("/");
        expect(
          type.extensions.every((extension) => /^\.[a-z0-9]+$/.test(extension)),
        ).toBe(true);
      }
      expect(new Set(tool.relatedSlugs).size).toBe(tool.relatedSlugs.length);
      expect(tool.relatedSlugs).not.toContain(tool.slug);
      for (const slug of tool.relatedSlugs) expect(getTool(slug)).toBeDefined();
      expect(getRelatedTools(tool).map((related) => related.slug)).toEqual(
        tool.relatedSlugs,
      );
      expect(tool).not.toHaveProperty("privacyLabel");
    }
  });

  it("matches the current architecture processing matrix", () => {
    const expected = {
      "merge-pdf": "LOCAL",
      "split-pdf": "LOCAL",
      "organize-pdf": "LOCAL",
      "extract-pdf-pages": "LOCAL",
      "delete-pdf-pages": "LOCAL",
      "rotate-pdf": "LOCAL",
      "jpg-to-pdf": "LOCAL",
      "pdf-to-jpg": "LOCAL",
      "remove-pdf-metadata": "LOCAL",
      "pdf-to-text": "LOCAL",
      "compress-pdf": "HYBRID",
      "pdf-to-word": "SERVER",
      "word-to-pdf": "SERVER",
    };
    expect(
      Object.fromEntries(tools.map((tool) => [tool.slug, tool.processingMode])),
    ).toEqual(expected);
  });

  it("only makes Merge available; other tools target catalog entries", () => {
    expect(
      tools
        .filter((tool) => tool.availability === "available")
        .map((tool) => tool.slug),
    ).toEqual(["merge-pdf"]);
    for (const tool of tools) {
      expect(getToolPath(tool)).toBe("/" + tool.slug);
      expect(getToolHref(tool)).toBe(
        tool.slug === "merge-pdf" ? "/merge-pdf" : "/tools#" + tool.slug,
      );
    }
    expect(getTool("not-a-tool")).toBeUndefined();
  });

  it("derives available metadata and retains planned qualifiers for unavailable tools", () => {
    const tool = getTool("merge-pdf")!;
    expect(getToolMetadata(tool)).toEqual({
      title: "Merge PDF",
      description: "Combine PDFs in the order you choose.",
    });
    expect(
      getToolMetadata({
        ...tool,
        availability: "planned",
        title: "Different task",
        description: "Different description.",
      }),
    ).toEqual({
      title: "Different task — Planned tool",
      description:
        "Different description. This tool is planned and cannot process documents yet.",
    });
  });

  it("uses live LOCAL wording and measured limits only for the available Merge tool", () => {
    const merge = getTool("merge-pdf")!;
    expect(
      getPrivacyPresentation(merge.processingMode, merge.availability).label,
    ).toBe("Processed on your device");
    expect(merge.limits).toEqual({
      maxFiles: 20,
      maxFileBytes: 10485760,
      maxTotalBytes: 33554432,
      maxPages: 200,
      maxOutputBytes: 33554432,
    });
    expect(
      tools
        .filter((tool) => tool.slug !== "merge-pdf")
        .every((tool) => tool.availability === "planned" && !tool.limits),
    ).toBe(true);
  });

  it.each([
    ["LOCAL", "Planned: processed on your device"],
    ["SERVER", "Planned: server processing"],
    ["HYBRID", "Planned: processing location depends on the operation/options"],
  ] as const)(
    "FR-GEN-004: derives truthful planned wording for %s",
    (mode, label) => {
      expect(getPrivacyPresentation(mode).label).toBe(label);
      expect(getPrivacyPresentation(mode).explanation).not.toMatch(
        /100%|certified|encrypted|60 minutes/i,
      );
    },
  );
});

describe("registry discovery selectors", () => {
  it("handles empty queries, case and whitespace, and preserves registry order", () => {
    expect(filterTools(tools, "   ")).toEqual(tools);
    expect(
      filterTools(tools, "   mErGe  PDF  ").map((tool) => tool.slug),
    ).toEqual(["merge-pdf"]);
  });
  it("searches descriptions and category labels", () => {
    expect(filterTools(tools, "DOCX").map((tool) => tool.slug)).toEqual([
      "pdf-to-word",
      "word-to-pdf",
    ]);
    expect(filterTools(tools, "convert").map((tool) => tool.category)).toEqual([
      "convert",
      "convert",
      "convert",
      "convert",
    ]);
  });
  it("combines category and query, and returns an empty result honestly", () => {
    expect(
      filterTools(tools, "PDF", "extract").map((tool) => tool.slug),
    ).toEqual(["extract-pdf-pages", "pdf-to-text"]);
    expect(filterTools(tools, "merge", "convert")).toEqual([]);
    expect(filterTools(tools, "nonexistent task")).toEqual([]);
  });
});
