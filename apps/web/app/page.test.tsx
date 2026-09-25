import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  categories,
  getTool,
  getToolMetadata,
  tools,
} from "@document-platform/tool-registry";
import HomePage from "./page";
import ToolsPage from "./tools/page";
import MergePreviewPage, { metadata as mergeMetadata } from "./merge-pdf/page";

describe("M1 registry integration", () => {
  it("renders homepage discovery from registry records", () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain("Find the right tool");
    for (const tool of tools.filter((item) => item.featured)) {
      expect(html).toContain(tool.title);
      expect(html).toContain(tool.description);
    }
    for (const category of categories) expect(html).toContain(category.title);
    expect(html).toContain('type="search"');
    expect(html).not.toMatch(/type="file"|<progress|download=/);
  });

  it("renders every catalog entry in initial HTML without requiring hydration", () => {
    const html = renderToStaticMarkup(<ToolsPage />);
    for (const tool of tools) {
      expect(html).toContain(`id="${tool.slug}"`);
      expect(html).toContain(tool.title);
      expect(html).toContain(tool.description);
    }
    expect(html).toContain("These tools are not functional yet.");
  });

  it("DEV-004 / FR-GEN-004: connects Merge record to metadata, shell and privacy", () => {
    const tool = getTool("merge-pdf")!;
    expect(mergeMetadata).toMatchObject(getToolMetadata(tool));
    expect(mergeMetadata.robots).toEqual({ index: false, follow: false });
    const html = renderToStaticMarkup(<MergePreviewPage />);
    expect(html).toContain(`<h1>${tool.title}</h1>`);
    expect(html).toContain(tool.description);
    expect(html).toContain("Planned: processed on your device");
    expect(html).toContain("This tool is not available yet");
    expect(html).not.toMatch(
      /<input|<button|<progress|download=|role="status"/,
    );
  });
});
