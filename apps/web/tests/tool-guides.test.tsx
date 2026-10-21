import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getRelatedTools,
  getTool,
  tools,
} from "@document-platform/tool-registry";
import { ToolGuide } from "../components/tool-guide";
import {
  getToolGuide,
  toolGuides,
  type ToolGuideContent,
} from "../content/tool-guides";

const available = tools.filter((tool) => tool.availability === "available");

function guideText(guide: ToolGuideContent): string[] {
  return [
    guide.overview,
    ...guide.steps,
    ...guide.goodToKnow,
    ...guide.faq.flatMap((item) => [item.question, item.answer]),
  ];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 5);
}

function wordCount(guide: ToolGuideContent): number {
  return guideText(guide).join(" ").split(/\s+/).length;
}

function collectSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectSource(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(readFileSync(path, "utf8"));
  }
  return out;
}

const productSource = [
  ...collectSource(resolve(__dirname, "../components")),
  ...collectSource(resolve(__dirname, "../../../packages/pdf-browser/src")),
].join("\n");

describe("M6B: a guide for exactly the tools that exist", () => {
  it("has a guide for every available tool", () => {
    for (const tool of available) {
      expect(getToolGuide(tool.slug), tool.slug).toBeDefined();
    }
  });

  it("has no guide for a tool the registry does not offer", () => {
    const offered = new Set(available.map((tool) => tool.slug));
    for (const slug of Object.keys(toolGuides)) {
      expect(
        offered.has(slug),
        `${slug} has a guide but is not available`,
      ).toBe(true);
    }
    expect(getTool("pdf-to-word")?.availability).toBe("planned");
    expect(getToolGuide("pdf-to-word")).toBeUndefined();
  });
});

describe("M6B: guide shape and substance", () => {
  it("has the agreed sections, none empty, no placeholders", () => {
    for (const [slug, guide] of Object.entries(toolGuides)) {
      expect(guide.overview.trim().length, slug).toBeGreaterThan(60);
      expect(guide.steps.length, `${slug} steps`).toBeGreaterThanOrEqual(3);
      expect(guide.steps.length, `${slug} steps`).toBeLessThanOrEqual(5);
      expect(guide.goodToKnow.length, `${slug} notes`).toBeGreaterThanOrEqual(
        3,
      );
      expect(guide.goodToKnow.length, `${slug} notes`).toBeLessThanOrEqual(6);
      expect(guide.faq.length, `${slug} faq`).toBeGreaterThanOrEqual(3);
      expect(guide.faq.length, `${slug} faq`).toBeLessThanOrEqual(4);
      for (const text of guideText(guide)) {
        expect(text.trim(), slug).not.toBe("");
        expect(text, slug).not.toMatch(/\b(TODO|TBD|lorem|ipsum|XXX)\b/i);
      }
    }
  });

  it("is real writing: enough words, but not padded", () => {
    for (const [slug, guide] of Object.entries(toolGuides)) {
      const words = wordCount(guide);
      expect(words, `${slug}: ${words} words`).toBeGreaterThanOrEqual(180);
      expect(words, `${slug}: ${words} words`).toBeLessThanOrEqual(520);
    }
  });

  it("keeps the overview short", () => {
    for (const [slug, guide] of Object.entries(toolGuides)) {
      expect(sentences(guide.overview).length, slug).toBeLessThanOrEqual(2);
    }
  });
});

describe("M6B: no templated or duplicated copy", () => {
  it("never repeats a sentence anywhere in the guides", () => {
    const seen = new Map<string, string>();
    for (const [slug, guide] of Object.entries(toolGuides)) {
      for (const sentence of guideText(guide).flatMap(sentences)) {
        const key = sentence.toLowerCase().replace(/\s+/g, " ");
        const first = seen.get(key);
        expect(
          first,
          `"${sentence}" is in ${first} and ${slug}`,
        ).toBeUndefined();
        seen.set(key, slug);
      }
    }
  });

  it("gives every tool its own overview and its own questions", () => {
    const overviews = Object.values(toolGuides).map((guide) => guide.overview);
    expect(new Set(overviews).size).toBe(overviews.length);
    const questions = Object.values(toolGuides).flatMap((guide) =>
      guide.faq.map((item) => item.question),
    );
    expect(new Set(questions).size).toBe(questions.length);
  });
});

describe("M6B: claims stay honest and in step with the product", () => {
  const all = Object.entries(toolGuides);

  it("makes no savings, speed or guarantee claims the tools do not make", () => {
    for (const [slug, guide] of all) {
      const text = guideText(guide).join(" ");
      expect(text, slug).not.toMatch(/up to \d+\s?%/i);
      // "at least 1% smaller" is Compress's real acceptance rule, not a promise.
      expect(text, slug).not.toMatch(
        /(?<!at least )\b\d+\s?% (smaller|faster|better)\b/i,
      );
      expect(text, slug).not.toMatch(
        /\b(perfect|flawless|instant|instantly|fastest|unlimited|military-grade|lossless)\b/i,
      );
      expect(text, slug).not.toMatch(/(?<!not )guaranteed|\bguarantees\b/i);
    }
  });

  it("does not copy registry limits into prose, where they could drift", () => {
    for (const [slug, guide] of all) {
      const text = guideText(guide).join(" ");
      expect(text, slug).not.toMatch(/\b\d[\d,.]*\s?(MiB|MB|GB|KB)\b/i);
      expect(text, slug).not.toMatch(
        /\b\d[\d,]*\s+(files|images|pages|outputs)\b/i,
      );
    }
  });

  it("describes on-device tools without uploads or servers, and the server tool with both", () => {
    for (const tool of available) {
      const text = guideText(getToolGuide(tool.slug)!).join(" ");
      if (tool.processingMode === "LOCAL") {
        expect(text, tool.slug).not.toMatch(/\bupload|\bserver\b/i);
      } else {
        expect(text, tool.slug).toMatch(/\bserver\b/i);
        expect(text, tool.slug).toMatch(/\buploaded\b/i);
        expect(text, tool.slug).toMatch(/\bdeleted\b|\bremoved\b/i);
      }
    }
  });

  it("names only output files that the product really produces", () => {
    for (const [slug, guide] of all) {
      const names = guideText(guide)
        .join(" ")
        .match(/\b[a-z][a-z0-9-]*\.(pdf|txt|zip|jpg)\b/g);
      for (const name of new Set(names ?? [])) {
        // "split-01.pdf" is built from a counter, so check the fixed prefix and
        // that the source builds the name from a template at that point.
        const prefix = name.replace(/\d+\.[a-z]+$/, "");
        const counted = prefix !== name;
        expect(
          counted
            ? productSource.includes(`${prefix}\${`)
            : productSource.includes(name),
          `${slug} mentions ${name}, which the product does not produce`,
        ).toBe(true);
      }
    }
  });

  it("quotes interface labels exactly as the product shows them", () => {
    const labels: [string, string][] = [
      ["merge-pdf", "Merge PDFs"],
      ["split-pdf", "Range groups"],
      ["split-pdf", "Individual selected pages"],
      ["extract-pdf-pages", "Select all pages"],
      ["extract-pdf-pages", "Clear selection"],
      ["delete-pdf-pages", "Export remaining pages"],
      ["rotate-pdf", "Rotate selected left"],
      ["rotate-pdf", "Rotate all left"],
    ];
    for (const [slug, label] of labels) {
      expect(guideText(getToolGuide(slug)!).join(" "), slug).toContain(label);
      expect(productSource, `${label} is not in the product`).toContain(label);
    }
  });

  it("describes what Images to PDF does with photo details (ADR-030)", () => {
    const text = guideText(getToolGuide("jpg-to-pdf")!).join(" ");
    // Before M6B.1 the JPEG bytes were embedded as they were, EXIF and all.
    expect(text).not.toMatch(/placed as they are|can remain inside the PDF/i);
    expect(text).toMatch(
      /camera details, location and other information[^.]*left out/i,
    );
  });

  it("warns that Remove PDF Metadata does not change the photos inside a PDF", () => {
    const text = guideText(getToolGuide("remove-pdf-metadata")!).join(" ");
    expect(text).toMatch(/photo[^.]*camera details[^.]*not changed/i);
  });
});

describe("M6B: the guide as rendered", () => {
  it.each(available.map((tool) => tool.slug))(
    "%s renders its guide before a labelled Related tools region",
    (slug) => {
      const tool = getTool(slug)!;
      const guide = getToolGuide(slug)!;
      const html = renderToStaticMarkup(<ToolGuide tool={tool} />);

      const headings = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(
        (match) => match[1],
      );
      expect(headings).toEqual([
        `About ${tool.title.replace("&", "&amp;")}`,
        `How to use ${tool.title.replace("&", "&amp;")}`,
        "Good to know",
        "Common questions",
        "Related tools",
      ]);

      expect(
        (html.match(/<ol>[\s\S]*?<\/ol>/) ?? [""])[0].split("<li>").length - 1,
      ).toBe(guide.steps.length);
      expect(html.match(/<h3>/g)?.length).toBeGreaterThanOrEqual(
        guide.faq.length,
      );
      expect(html.indexOf("tool-guide")).toBeLessThan(
        html.indexOf('aria-label="Related tools"'),
      );
      for (const related of getRelatedTools(tool)) {
        expect(html).toContain(related.title);
      }
      expect(html).not.toContain("dangerouslySetInnerHTML");
    },
  );
});
