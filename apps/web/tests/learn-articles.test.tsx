import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTool, tools } from "@document-platform/tool-registry";
import { LearnArticlePage, sectionId } from "../components/learn-article";
import { LearnList } from "../components/learn-list";
import { SiteHeader } from "../components/site-header";
import { ToolGuide } from "../components/tool-guide";
import {
  getLearnArticle,
  getLearnArticlesForTool,
  learnArticles,
  type LearnArticle,
  type LearnBlock,
} from "../content/learn-articles";
import { toolGuides } from "../content/tool-guides";
import { getIndexablePaths } from "../lib/seo";
import {
  plainText,
  resolveInline,
  type ResolvedSegment,
} from "../lib/learn-text";
import LearnPage from "../app/learn/page";
import HomePage from "../app/page";

const available = tools.filter((tool) => tool.availability === "available");
const APP_DIR = resolve(__dirname, "../app");

function blockStrings(block: LearnBlock): string[] {
  if (typeof block === "string") return [block];
  return "steps" in block ? [...block.steps] : [...block.list];
}

/** Every paragraph, list item and step of the body, with link tokens intact. */
function bodyStrings(article: LearnArticle): string[] {
  return [
    article.intro,
    ...article.sections.flatMap((section) =>
      section.blocks.flatMap(blockStrings),
    ),
  ];
}

/** Everything a reader can see, as plain text. */
function readerText(article: LearnArticle): string[] {
  return [
    article.title,
    article.summary,
    ...article.sections.map((section) => section.heading),
    ...bodyStrings(article).map(plainText),
  ];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 5);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function toolGuideStrings(): [string, string[]][] {
  return Object.entries(toolGuides).map(([slug, guide]) => [
    `tool guide ${slug}`,
    [
      guide.overview,
      ...guide.steps,
      ...guide.goodToKnow,
      ...guide.faq.flatMap((item) => [item.question, item.answer]),
    ],
  ]);
}

function collectSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectSource(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry))
      out.push(readFileSync(path, "utf8"));
  }
  return out;
}

const productSource = [
  ...collectSource(resolve(__dirname, "../components")),
  ...collectSource(resolve(__dirname, "../../../packages/pdf-browser/src")),
  ...collectSource(resolve(__dirname, "../../../packages/ui/src")),
].join("\n");

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function render(article: LearnArticle): string {
  return renderToStaticMarkup(<LearnArticlePage slug={article.slug} />);
}

describe("M6C: the guides and their pages match one to one", () => {
  it("has the agreed number of guides, with unique slugs", () => {
    expect(learnArticles).toHaveLength(8);
    const slugs = learnArticles.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("has a page for every guide and a guide for every page", () => {
    const folders = readdirSync(join(APP_DIR, "learn")).filter((entry) =>
      statSync(join(APP_DIR, "learn", entry)).isDirectory(),
    );
    expect(folders.sort()).toEqual(
      learnArticles.map((article) => article.slug).sort(),
    );
    for (const article of learnArticles) {
      const file = join(APP_DIR, "learn", article.slug, "page.tsx");
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8")).toContain(
        `learnMetadata("${article.slug}")`,
      );
    }
    expect(existsSync(join(APP_DIR, "learn", "page.tsx"))).toBe(true);
  });

  it("lists the hub and every guide for the sitemap", () => {
    const paths = getIndexablePaths();
    expect(paths).toContain("/learn");
    for (const article of learnArticles)
      expect(paths).toContain(`/learn/${article.slug}`);
  });

  it("looks guides up by slug and by tool", () => {
    expect(getLearnArticle("nonexistent")).toBeUndefined();
    expect(getLearnArticle(learnArticles[0].slug)).toBe(learnArticles[0]);
    for (const article of learnArticles)
      for (const slug of article.tools)
        expect(getLearnArticlesForTool(slug)).toContain(article);
  });
});

describe("M6C: every link resolves to something real", () => {
  it("lists only available tools, and every available tool has a guide", () => {
    for (const article of learnArticles) {
      expect(article.tools.length, article.slug).toBeGreaterThan(0);
      expect(new Set(article.tools).size, article.slug).toBe(
        article.tools.length,
      );
      for (const slug of article.tools) {
        expect(getTool(slug)?.availability, `${article.slug}: ${slug}`).toBe(
          "available",
        );
      }
    }
    for (const tool of available) {
      expect(
        getLearnArticlesForTool(tool.slug).length,
        `${tool.slug} needs a guide`,
      ).toBeGreaterThan(0);
    }
    expect(getTool("pdf-to-word")?.availability).toBe("planned");
    expect(getLearnArticlesForTool("pdf-to-word")).toEqual([]);
  });

  it("names a related guide that exists, is not itself, and is not repeated", () => {
    for (const article of learnArticles) {
      expect(article.related.length, article.slug).toBeGreaterThan(0);
      expect(new Set(article.related).size).toBe(article.related.length);
      for (const slug of article.related) {
        expect(slug, article.slug).not.toBe(article.slug);
        expect(
          getLearnArticle(slug),
          `${article.slug} -> ${slug}`,
        ).toBeDefined();
      }
    }
  });

  it("leaves no guide without a way in from another guide", () => {
    for (const article of learnArticles) {
      const inbound = learnArticles.filter(
        (other) =>
          other.slug !== article.slug &&
          (other.related.includes(article.slug) ||
            bodyStrings(other).some((text) =>
              resolveInline(text).some(
                (segment) =>
                  segment.kind === "link" &&
                  segment.target === "learn" &&
                  segment.slug === article.slug,
              ),
            )),
      );
      expect(inbound.length, `${article.slug} is an orphan`).toBeGreaterThan(0);
    }
  });

  it("resolves every inline link and links each guide's primary tool in the body", () => {
    for (const article of learnArticles) {
      const segments = bodyStrings(article).flatMap(resolveInline);
      const toolLinks = segments.filter(
        (segment): segment is Extract<ResolvedSegment, { kind: "link" }> =>
          segment.kind === "link" && segment.target === "tool",
      );
      expect(toolLinks.length, article.slug).toBeGreaterThan(0);
      const linked = new Set(toolLinks.map((segment) => segment.slug));
      expect(linked.has(article.tools[0]), `${article.slug} primary`).toBe(
        true,
      );
      for (const text of bodyStrings(article))
        expect(plainText(text), article.slug).not.toMatch(/[{}]/);
    }
  });

  it("rejects links that point at nothing", () => {
    expect(() => resolveInline("{tool:pdf-to-word}")).toThrow(
      /not an available/,
    );
    expect(() => resolveInline("{tool:no-such-tool}")).toThrow();
    expect(() => resolveInline("{learn:no-such-guide}")).toThrow(/not a guide/);
    expect(() => resolveInline("{page:/nowhere|Nowhere}")).toThrow(
      /not a static page/,
    );
    expect(() => resolveInline("{page:/privacy}")).toThrow(/needs link text/);
    expect(() => resolveInline("{page:/|Home}")).toThrow();
    expect(() => resolveInline("Broken {tool:merge-pdf")).toThrow(/Malformed/);
  });

  it("resolves the three token kinds, with registry titles by default", () => {
    expect(resolveInline("See {tool:merge-pdf}.")).toEqual([
      { kind: "text", text: "See " },
      {
        kind: "link",
        target: "tool",
        slug: "merge-pdf",
        href: "/merge-pdf",
        label: "Merge PDF",
      },
      { kind: "text", text: "." },
    ]);
    expect(
      plainText("{tool:merge-pdf|joining files} and {page:/privacy|Privacy}"),
    ).toBe("joining files and Privacy");
    const first = learnArticles[0];
    expect(plainText(`{learn:${first.slug}}`)).toBe(first.title);
  });
});

describe("M6C: titles, descriptions and summaries", () => {
  it("has short, unique titles", () => {
    const titles = learnArticles.map((article) => article.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) {
      expect(title.length, title).toBeLessThanOrEqual(64);
      expect(title.length, title).toBeGreaterThanOrEqual(20);
    }
  });

  it("has unique, plain-text descriptions of a useful length", () => {
    const descriptions = learnArticles.map((article) => article.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const description of descriptions) {
      expect(description.length, description).toBeGreaterThanOrEqual(110);
      expect(description.length, description).toBeLessThanOrEqual(160);
      expect(description).not.toMatch(/[{}<>]/);
    }
  });

  it("has unique summaries of at most two sentences", () => {
    const summaries = learnArticles.map((article) => article.summary);
    expect(new Set(summaries).size).toBe(summaries.length);
    for (const article of learnArticles) {
      expect(article.summary).not.toMatch(/[{}<>]/);
      expect(
        sentences(article.summary).length,
        article.slug,
      ).toBeLessThanOrEqual(2);
      expect(article.summary, article.slug).not.toBe(article.description);
    }
  });

  it("features exactly three guides, for the home page", () => {
    expect(learnArticles.filter((article) => article.featured)).toHaveLength(3);
  });
});

describe("M6C: substance, not filler", () => {
  it("has the agreed shape, no empty parts and no placeholders", () => {
    for (const article of learnArticles) {
      expect(article.sections.length, article.slug).toBeGreaterThanOrEqual(4);
      expect(article.sections.length, article.slug).toBeLessThanOrEqual(8);
      const headings = article.sections.map((section) => section.heading);
      expect(new Set(headings).size, article.slug).toBe(headings.length);
      expect(new Set(headings.map(sectionId)).size, article.slug).toBe(
        headings.length,
      );
      for (const section of article.sections) {
        expect(section.blocks.length, section.heading).toBeGreaterThan(0);
      }
      for (const text of readerText(article)) {
        expect(text.trim(), article.slug).not.toBe("");
        expect(text, article.slug).not.toMatch(
          /\b(TODO|TBD|lorem|ipsum|XXX|coming soon)\b/i,
        );
      }
    }
  });

  it("is real writing: enough words, but not padded", () => {
    for (const article of learnArticles) {
      const count = bodyStrings(article)
        .map(plainText)
        .join(" ")
        .split(/\s+/).length;
      expect(count, `${article.slug}: ${count} words`).toBeGreaterThanOrEqual(
        450,
      );
      expect(count, `${article.slug}: ${count} words`).toBeLessThanOrEqual(
        1300,
      );
    }
  });

  it("opens with a short paragraph and not a wall of text", () => {
    for (const article of learnArticles) {
      expect(
        sentences(plainText(article.intro)).length,
        article.slug,
      ).toBeGreaterThanOrEqual(2);
      expect(
        sentences(plainText(article.intro)).length,
        article.slug,
      ).toBeLessThanOrEqual(4);
      for (const text of bodyStrings(article)) {
        expect(
          plainText(text).split(/\s+/).length,
          article.slug,
        ).toBeLessThanOrEqual(120);
      }
    }
  });
});

describe("M6C: no repeated or templated copy", () => {
  it("never repeats a sentence, in the guides or against the tool guides", () => {
    const seen = new Map<string, string>();
    const corpus: [string, string[]][] = [
      ...learnArticles.map((article): [string, string[]] => [
        `guide ${article.slug}`,
        [article.summary, ...bodyStrings(article).map(plainText)],
      ]),
      ...toolGuideStrings(),
    ];
    for (const [source, texts] of corpus) {
      for (const sentence of texts.flatMap(sentences)) {
        const key = sentence.toLowerCase().replace(/\s+/g, " ");
        const first = seen.get(key);
        expect(
          first,
          `"${sentence}" is in ${first} and ${source}`,
        ).toBeUndefined();
        seen.set(key, source);
      }
    }
  });

  it("shares no run of nine words between two different texts", () => {
    const owner = new Map<string, string>();
    const conflicts: string[] = [];
    const corpus: [string, string[]][] = [
      ...learnArticles.map((article): [string, string[]] => [
        `guide ${article.slug}`,
        [article.summary, ...bodyStrings(article).map(plainText)],
      ]),
      ...toolGuideStrings(),
    ];
    for (const [source, texts] of corpus) {
      const mine = new Set<string>();
      for (const text of texts) {
        const list = words(text);
        for (let i = 0; i + 9 <= list.length; i++)
          mine.add(list.slice(i, i + 9).join(" "));
      }
      for (const gram of mine) {
        const first = owner.get(gram);
        // Overlap between two tool guides is M6B's business, not this test's.
        const involvesLearn =
          source.startsWith("guide ") || first?.startsWith("guide ");
        if (first !== undefined && first !== source && involvesLearn)
          conflicts.push(`"${gram}" is in ${first} and ${source}`);
        if (first === undefined || source.startsWith("guide "))
          owner.set(gram, source);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("gives every guide its own opening and its own headings", () => {
    const intros = learnArticles.map((article) => article.intro);
    expect(new Set(intros).size).toBe(intros.length);
    const openers = learnArticles.map((article) =>
      words(plainText(article.intro)).slice(0, 4).join(" "),
    );
    expect(new Set(openers).size).toBe(openers.length);
    const all = learnArticles.flatMap((article) =>
      article.sections.map((section) => section.heading.toLowerCase()),
    );
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("M6C: claims stay honest and in step with the product", () => {
  const everything = learnArticles.map(
    (article) => [article.slug, readerText(article).join("\n")] as const,
  );

  it("makes no savings, speed, certainty or guarantee claims the tools do not make", () => {
    for (const [slug, text] of everything) {
      expect(text, slug).not.toMatch(/up to \d+\s?%/i);
      expect(text, slug).not.toMatch(/\b\d+\s?% (smaller|faster|better)\b/i);
      expect(text, slug).not.toMatch(/100\s?%/);
      expect(text, slug).not.toMatch(
        /\b(perfect|perfectly|flawless|instant|instantly|fastest|unlimited|military-grade|bank-grade|foolproof|completely safe|totally safe)\b/i,
      );
      expect(text, slug).not.toMatch(/(?<!not )guaranteed|\bguarantees\b/i);
    }
  });

  it("does not call Compress PDF lossless", () => {
    for (const article of learnArticles) {
      for (const text of readerText(article)) {
        for (const sentence of text.split(/(?<=[.!?])\s+/)) {
          if (/compress pdf/i.test(sentence))
            expect(sentence, article.slug).not.toMatch(/lossless/i);
        }
      }
    }
  });

  it("does not copy registry limits into prose, where they could drift", () => {
    for (const [slug, text] of everything) {
      expect(text, slug).not.toMatch(/\b\d[\d,.]*\s?(MiB|MB|GB|KB)\b/i);
      expect(text, slug).not.toMatch(
        /\b\d[\d,]*\s+(files|images|pages|outputs|megapixels)\b/i,
      );
      expect(text, slug).not.toMatch(/\bmaximum of\b|\bat most \d/i);
    }
  });

  it("invents no byline, date, review or endorsement (M6D owns those)", () => {
    for (const [slug, text] of everything) {
      expect(text, slug).not.toMatch(
        /\b(reviewed by|written by|by our (team|experts)|last updated|updated on|published on|fact-checked|certified|endorsed|recommended by)\b/i,
      );
      expect(text, slug).not.toMatch(/\b20[12]\d\b/);
      expect(text, slug).not.toMatch(
        /\b(our experts|our editors|our lawyers)\b/i,
      );
    }
  });

  it("states no retention period and no offline promise", () => {
    for (const [slug, text] of everything) {
      expect(text, slug).not.toMatch(
        /\b\d+\s*(seconds?|minutes?|hours?|days?)\b/i,
      );
      expect(text, slug).not.toMatch(/\boffline\b|without (an )?internet/i);
    }
  });

  it("mentions uploads only to deny them, to describe Word to PDF, or for forms", () => {
    for (const article of learnArticles) {
      // Titles and headings only name the topic; the claims are in the prose.
      const prose = [article.summary, ...bodyStrings(article).map(plainText)];
      for (const text of prose) {
        // A paragraph about Word to PDF may explain its upload over several sentences.
        const aboutWordToPdf = /word to pdf/i.test(text);
        for (const sentence of text.split(/(?<=[.!?])\s+/)) {
          if (!/\bupload|\bserver\b/i.test(sentence)) continue;
          const ok =
            aboutWordToPdf ||
            /\b(without|not|never|nothing|none|no one|neither|rather than|instead|fail|fails)\b/i.test(
              sentence,
            ) ||
            /word to pdf/i.test(sentence) ||
            /\b(upload forms?|our server|the server|a server|a stranger's server|an upload|upload or processing)\b/i.test(
              sentence,
            );
          expect(ok, `${article.slug}: "${sentence}"`).toBe(true);
        }
      }
    }
  });

  it("names only output files that the product really produces", () => {
    for (const article of learnArticles) {
      const names = readerText(article)
        .join(" ")
        .match(/\b[a-z][a-z0-9-]*\.(pdf|txt|zip|jpg)\b/g);
      for (const name of new Set(names ?? [])) {
        const prefix = name.replace(/\d+\.[a-z]+$/, "");
        const counted = prefix !== name;
        expect(
          counted
            ? productSource.includes(`${prefix}\${`)
            : productSource.includes(name),
          `${article.slug} mentions ${name}, which the product does not produce`,
        ).toBe(true);
      }
    }
  });

  it("quotes interface labels exactly as the product shows them", () => {
    const labels: [string, string][] = [
      ["merge-pdfs-without-uploading", "Merge PDFs"],
      ["merge-pdfs-without-uploading", "Add PDFs"],
      ["merge-pdfs-without-uploading", "Move earlier"],
      ["merge-pdfs-without-uploading", "Move later"],
      ["split-a-pdf-or-keep-some-pages", "Individual selected pages"],
      ["photos-and-scans-into-one-pdf", "Create PDF"],
      ["photos-and-scans-into-one-pdf", "Move earlier"],
      ["photos-and-scans-into-one-pdf", "Contain"],
      ["photos-and-scans-into-one-pdf", "Cover"],
      ["save-pdf-pages-as-images", "Create JPG images"],
      ["save-pdf-pages-as-images", "All pages"],
      ["save-pdf-pages-as-images", "Selected pages"],
      ["copy-text-from-a-pdf", "Copy text"],
      ["copy-text-from-a-pdf", "Download TXT"],
    ];
    for (const [slug, label] of labels) {
      const article = getLearnArticle(slug)!;
      expect(
        readerText(article).join(" "),
        `${slug} should say ${label}`,
      ).toContain(label);
      expect(productSource, `${label} is not in the product`).toContain(label);
    }
  });

  it("only gives resolutions and strengths the tools offer", () => {
    expect(productSource).toMatch(/value: 96\b/);
    expect(productSource).toMatch(/value: 150\b/);
    expect(productSource).toMatch(/value: 300\b/);
    const compress = readerText(getLearnArticle("make-a-pdf-smaller")!).join(
      " ",
    );
    for (const strength of ["Light", "Balanced", "Strong"]) {
      expect(compress).toContain(strength);
      expect(productSource).toContain(strength);
    }
  });

  it("states only pixel sizes that an A4 page really has at 96, 150 or 300 DPI", () => {
    const a4 = { w: 595.28, h: 841.89 };
    const real = new Set(
      [96, 150, 300].map((dpi) => {
        const w = Math.round((a4.w * dpi) / 72).toLocaleString("en-US");
        const h = Math.round((a4.h * dpi) / 72).toLocaleString("en-US");
        return `${w} by ${h}`;
      }),
    );
    const stated = learnArticles.flatMap((article) =>
      [
        ...readerText(article)
          .join(" ")
          .matchAll(/\b([\d,]+ by [\d,]+) pixels/g),
      ].map((match) => match[1]),
    );
    expect(stated.length).toBeGreaterThanOrEqual(2);
    for (const size of stated) expect(real.has(size), size).toBe(true);
    const text = readerText(getLearnArticle("save-pdf-pages-as-images")!).join(
      " ",
    );
    expect(text).toContain("794 by 1,123 pixels");
    // 300 / 96 is just over three; its square is nearly ten.
    expect(Math.round((300 / 96) * 10) / 10).toBe(3.1);
    expect(Math.round((300 / 96) ** 2 * 10) / 10).toBe(9.8);
  });

  it("keeps the Word to PDF description consistent with the privacy copy", () => {
    const serverTools = available.filter(
      (tool) => tool.processingMode === "SERVER",
    );
    expect(serverTools.map((tool) => tool.slug)).toEqual(["word-to-pdf"]);
    const article = getLearnArticle("what-processed-on-your-device-means")!;
    const text = readerText(article).join(" ");
    expect(article.tools).toContain("word-to-pdf");
    expect(text).toContain("Word to PDF");
    expect(text).toMatch(/encrypted on its way to our server/);
    expect(text).toMatch(/deleted once the PDF has reached your browser/);
    expect(text).toMatch(/abandoned[^.]*automatic cleanup after a short time/);
    expect(text).toMatch(/not shared with third parties/);
    expect(text).toContain("Processed on your device");
    expect(text).toContain("Secure server processing");
    // The privacy page still says retention is undecided; the guide defers to it.
    expect(text).toMatch(/still undecided/);
    expect(text).toMatch(/retention period/);
  });

  it("is honest that OCR is not available, and that PDF to Word is not", () => {
    const text = readerText(getLearnArticle("copy-text-from-a-pdf")!).join(" ");
    expect(text).toMatch(/does not do OCR/);
    expect(text).toMatch(/not available yet/);
    for (const article of learnArticles) {
      expect(readerText(article).join(" "), article.slug).not.toMatch(
        /\b(convert|converts|converting) (a )?PDFs? to Word\b/i,
      );
    }
  });

  it("never says Remove PDF Metadata redacts, anonymises or sanitises", () => {
    const text = readerText(getLearnArticle("whats-hidden-in-a-pdf")!).join(
      " ",
    );
    expect(text).toMatch(/does not redact/);
    expect(text).not.toMatch(/\b(sanitis|sanitiz|scrub|wipe|securely erase)/i);
    for (const article of learnArticles) {
      for (const sentence of readerText(article)
        .join(" ")
        .split(/(?<=[.!?])\s+/)) {
        if (/anonym/i.test(sentence))
          expect(sentence, article.slug).toMatch(/never claims|not/i);
      }
    }
  });
});

describe("M6C: pages as rendered", () => {
  it.each(learnArticles.map((article) => article.slug))(
    "%s renders one h1, a contents list that points at real sections, and no dead links",
    (slug) => {
      const article = getLearnArticle(slug)!;
      const html = render(article);

      expect(html.match(/<h1[ >]/g)).toHaveLength(1);
      expect(html).toContain(`<h1>${escapeHtml(article.title)}</h1>`);

      const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
      expect(ids).toEqual(article.sections.map((s) => sectionId(s.heading)));
      const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
      expect(anchors).toEqual(ids);

      const indexable = new Set(getIndexablePaths());
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((href) => !href.startsWith("#"));
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs)
        expect(indexable.has(href), `${slug} links to ${href}`).toBe(true);

      const sections = html.match(/<section aria-labelledby="/g) ?? [];
      expect(sections).toHaveLength(article.sections.length);
      for (const toolSlug of article.tools)
        expect(html).toContain(`href="/${toolSlug}"`);
      for (const related of article.related)
        expect(html).toContain(`href="/learn/${related}"`);

      expect(html).toContain('aria-label="In this guide"');
      expect(html).toContain('aria-label="Tools in this guide"');
      expect(html).toContain('aria-label="Keep reading"');
      expect(html).not.toContain("dangerouslySetInnerHTML");
      expect(html).not.toMatch(/[{}]/);
    },
  );

  it("renders lists and steps as real lists", () => {
    const merge = getLearnArticle("merge-pdfs-without-uploading")!;
    const html = render(merge);
    expect(html).toMatch(
      /<ol><li>Open <a href="\/merge-pdf">Merge PDF<\/a> and choose/,
    );
    expect(html).toMatch(/<ul><li>Page content\./);
  });

  it("links the hub to every guide and the guides to the hub", () => {
    const hub = renderToStaticMarkup(<LearnPage />);
    expect(hub.match(/<h1[ >]/g)).toHaveLength(1);
    for (const article of learnArticles) {
      expect(hub).toContain(`href="/learn/${article.slug}"`);
      expect(hub).toContain(escapeHtml(article.summary));
      expect(render(article)).toContain('href="/learn"');
    }
    expect(hub).toContain('href="/tools"');
  });

  it("shows the featured guides on the home page, and the Learn link in the header", () => {
    const home = renderToStaticMarkup(<HomePage />);
    const featured = learnArticles.filter((article) => article.featured);
    for (const article of featured)
      expect(home).toContain(`href="/learn/${article.slug}"`);
    for (const article of learnArticles.filter((a) => !a.featured))
      expect(home).not.toContain(`href="/learn/${article.slug}"`);
    expect(home).toContain('href="/learn"');
    expect(home).toContain("From the guides");

    const header = renderToStaticMarkup(<SiteHeader />);
    expect(header).toContain('href="/learn"');
    expect(header.indexOf('href="/tools"')).toBeLessThan(
      header.indexOf('href="/learn"'),
    );
  });

  it("renders the list with the heading level it is given", () => {
    const html = renderToStaticMarkup(
      <LearnList articles={learnArticles.slice(0, 2)} headingLevel={2} />,
    );
    expect(html.match(/<h2>/g)).toHaveLength(2);
    expect(
      renderToStaticMarkup(<LearnList articles={learnArticles.slice(0, 1)} />),
    ).toContain("<h3>");
  });

  it.each(available.map((tool) => tool.slug))(
    "%s links back to the guides that cover it",
    (slug) => {
      const tool = getTool(slug)!;
      const html = renderToStaticMarkup(<ToolGuide tool={tool} />);
      const expected = getLearnArticlesForTool(slug);
      expect(expected.length).toBeGreaterThan(0);
      expect(html).toContain('<h2 id="guide-learn">Learn more</h2>');
      for (const article of expected)
        expect(html).toContain(`href="/learn/${article.slug}"`);
      const linked = [...html.matchAll(/href="\/learn\/([^"]+)"/g)].map(
        (m) => m[1],
      );
      expect(linked.sort()).toEqual(expected.map((a) => a.slug).sort());
      expect(html.indexOf("guide-learn")).toBeLessThan(
        html.indexOf('aria-label="Related tools"'),
      );
    },
  );
});
