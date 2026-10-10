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
import OrganizePage, {
  metadata as organizeMetadata,
} from "./organize-pdf/page";
import ExtractPage, {
  metadata as extractMetadata,
} from "./extract-pdf-pages/page";
import DeletePage, {
  metadata as deleteMetadata,
} from "./delete-pdf-pages/page";
import RotatePage, { metadata as rotateMetadata } from "./rotate-pdf/page";
import SplitPage, { metadata as splitMetadata } from "./split-pdf/page";
import ImagesToPdfPage, {
  metadata as imagesToPdfMetadata,
} from "./jpg-to-pdf/page";
import PdfToJpgPage, { metadata as pdfToJpgMetadata } from "./pdf-to-jpg/page";

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
    expect(html).toContain("Eight tools are available.");
  });

  it("DEV-004 / FR-GEN-004: connects Merge record to metadata, shell and privacy", () => {
    const tool = getTool("merge-pdf")!;
    expect(mergeMetadata).toMatchObject(getToolMetadata(tool));
    expect(mergeMetadata.robots).toEqual({ index: false, follow: false });
    const html = renderToStaticMarkup(<MergePreviewPage />);
    expect(html).toContain(`<h1>${tool.title}</h1>`);
    expect(html).toContain(tool.description);
    expect(html).toContain("Processed on your device");
    expect(html).toContain("Bring your PDFs together");
    expect(html).toContain('type="file"');
    expect(html).toContain("Password-protected PDFs are not supported");
    expect(html).not.toMatch(/<progress|download=/);
  });

  it("FR-ORG-001: connects Organize to registry metadata and a real local picker", () => {
    const tool = getTool("organize-pdf")!;
    expect(organizeMetadata).toMatchObject(getToolMetadata(tool));
    expect(organizeMetadata.robots).toEqual({ index: false, follow: false });
    const html = renderToStaticMarkup(<OrganizePage />);
    expect(html).toContain(`<h1>${tool.title}</h1>`);
    expect(html).toContain("Processed on your device");
    expect(html).toContain("Choose a PDF to organize");
    expect(html).toContain('type="file"');
    expect(html).not.toContain('multiple=""');
  });

  it.each([
    [
      "extract-pdf-pages",
      ExtractPage,
      extractMetadata,
      "Choose a PDF to extract pages from",
    ],
    [
      "delete-pdf-pages",
      DeletePage,
      deleteMetadata,
      "Choose a PDF to remove pages from",
    ],
    ["rotate-pdf", RotatePage, rotateMetadata, "Choose a PDF to rotate"],
    ["split-pdf", SplitPage, splitMetadata, "Choose a PDF to split"],
  ] as const)(
    "connects %s to registry metadata and a real local picker",
    (slug, Page, metadata, heading) => {
      const tool = getTool(slug)!;
      expect(metadata).toMatchObject(getToolMetadata(tool));
      expect(metadata.robots).toEqual({ index: false, follow: false });
      const html = renderToStaticMarkup(<Page />);
      expect(html).toContain(`<h1>${tool.title}</h1>`);
      expect(html).toContain("Processed on your device");
      expect(html).toContain(heading);
      expect(html).toContain('type="file"');
      expect(html).not.toContain('multiple=""');
    },
  );

  it("FR-I2P-001/003: connects Images to PDF to its local multi-image workspace", () => {
    const tool = getTool("jpg-to-pdf")!;
    expect(imagesToPdfMetadata).toMatchObject(getToolMetadata(tool));
    expect(imagesToPdfMetadata.robots).toEqual({ index: false, follow: false });
    const html = renderToStaticMarkup(<ImagesToPdfPage />);
    expect(html).toContain(`<h1>${tool.title}</h1>`);
    expect(html).toContain("Processed on your device");
    expect(html).toContain("Build a PDF from images");
    expect(html).toContain('type="file"');
    expect(html).toContain('multiple=""');
  });

  it("FR-P2I-001/003: connects PDF to JPG to its local page-image workspace", () => {
    const tool = getTool("pdf-to-jpg")!;
    expect(pdfToJpgMetadata).toMatchObject(getToolMetadata(tool));
    expect(pdfToJpgMetadata.robots).toEqual({ index: false, follow: false });
    const html = renderToStaticMarkup(<PdfToJpgPage />);
    expect(html).toContain(`<h1>${tool.title}</h1>`);
    expect(html).toContain("Processed on your device");
    expect(html).toContain("Choose a PDF to turn into JPG images");
    expect(html).toContain('type="file"');
    expect(html).not.toContain('multiple=""');
  });
});
