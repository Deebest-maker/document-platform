import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getTool,
  getToolMetadata,
  tools,
  type ToolDefinition,
} from "@document-platform/tool-registry";
import {
  DEFAULT_TITLE,
  SITE_NAME,
  STATIC_INDEXABLE_PATHS,
  buildRobots,
  buildSitemap,
  getIndexablePaths,
  seoMetadata,
  siteRobots,
  toolMetadata,
} from "../lib/seo";
import { learnArticles } from "../content/learn-articles";
import type { SiteConfig } from "../lib/site";

const ORIGIN = "https://example.com";
const off: SiteConfig = { origin: undefined, indexing: false };
const stagingOff: SiteConfig = { origin: ORIGIN, indexing: false };
const on: SiteConfig = { origin: ORIGIN, indexing: true };

const merge = getTool("merge-pdf")!;
const wordToPdf = getTool("word-to-pdf")!;

describe("M6A page metadata", () => {
  it("is noindex and has no canonical or Open Graph data when no origin is known", () => {
    const metadata = seoMetadata(
      { title: "Merge PDF", description: "Merge files.", path: "/merge-pdf" },
      off,
    );
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.title).toBe("Merge PDF");
  });

  it("stays noindex when an origin exists but indexing is off", () => {
    const metadata = seoMetadata(
      { title: "Merge PDF", description: "Merge files.", path: "/merge-pdf" },
      stagingOff,
    );
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toEqual({ canonical: "/merge-pdf" });
  });

  it("is indexable with a clean canonical path and Open Graph data when on", () => {
    const metadata = seoMetadata(
      { title: "Merge PDF", description: "Merge files.", path: "/merge-pdf" },
      on,
    );
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates).toEqual({ canonical: "/merge-pdf" });
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: SITE_NAME,
      title: `Merge PDF | ${SITE_NAME}`,
      description: "Merge files.",
      url: "/merge-pdf",
    });
    const canonical = (metadata.alternates?.canonical ?? "") as string;
    expect(canonical).not.toMatch(/[?#]/);
  });

  it("lets the home page inherit the site title", () => {
    const metadata = seoMetadata({ description: "Home.", path: "/" }, on);
    expect("title" in metadata).toBe(false);
    expect(metadata.openGraph).toMatchObject({ title: DEFAULT_TITLE });
  });

  it("builds tool metadata from the registry record", () => {
    const metadata = toolMetadata(merge, on);
    expect(metadata).toMatchObject(getToolMetadata(merge));
    expect(metadata.alternates).toEqual({ canonical: "/merge-pdf" });
    expect(toolMetadata(merge, off).alternates).toBeUndefined();
  });

  it("reports robots from the config only", () => {
    expect(siteRobots(off)).toEqual({ index: false, follow: false });
    expect(siteRobots(on)).toEqual({ index: true, follow: true });
  });
});

describe("M6A robots.txt", () => {
  it("blocks everything and links no sitemap when indexing is off", () => {
    expect(buildRobots(off)).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
    expect(buildRobots(stagingOff)).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });

  it("allows the site, blocks the API proxy and links the sitemap when on", () => {
    expect(buildRobots(on)).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: `${ORIGIN}/sitemap.xml`,
    });
  });
});

describe("M6A sitemap", () => {
  it("is empty unless indexing is on", () => {
    expect(buildSitemap(off)).toEqual([]);
    expect(buildSitemap(stagingOff)).toEqual([]);
  });

  it("lists static pages and available tools as absolute https URLs", () => {
    const urls = buildSitemap(on).map((entry) => entry.url);
    expect(urls).toContain(ORIGIN);
    for (const path of STATIC_INDEXABLE_PATHS.filter((p) => p !== "/")) {
      expect(urls).toContain(`${ORIGIN}${path}`);
    }
    for (const tool of tools.filter((t) => t.availability === "available")) {
      expect(urls).toContain(`${ORIGIN}/${tool.slug}`);
    }
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/example\.com(\/[a-z0-9-]+){0,2}$/);
    }
  });

  it("leaves out planned tools, such as PDF to Word", () => {
    const planned = tools.filter((t) => t.availability !== "available");
    expect(planned.map((t) => t.slug)).toContain("pdf-to-word");
    const urls = buildSitemap(on).map((entry) => entry.url);
    for (const tool of planned) {
      expect(urls).not.toContain(`${ORIGIN}/${tool.slug}`);
    }
  });

  it("lists the Learn hub and every guide", () => {
    const urls = buildSitemap(on).map((entry) => entry.url);
    expect(urls).toContain(`${ORIGIN}/learn`);
    expect(learnArticles.length).toBeGreaterThan(0);
    for (const article of learnArticles) {
      expect(urls).toContain(`${ORIGIN}/learn/${article.slug}`);
    }
  });

  it("has no duplicates and no invented modification data", () => {
    const entries = buildSitemap(on);
    const urls = entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const entry of entries) {
      expect(Object.keys(entry)).toEqual(["url"]);
    }
  });

  it("follows the registry when a tool changes state", () => {
    const planned: ToolDefinition = { ...merge, availability: "planned" };
    const preview: ToolDefinition = { ...wordToPdf, availability: "preview" };
    expect(getIndexablePaths([planned, preview], [])).toEqual([
      ...STATIC_INDEXABLE_PATHS,
    ]);
    expect(getIndexablePaths([merge, merge], [])).toEqual([
      ...STATIC_INDEXABLE_PATHS,
      "/merge-pdf",
    ]);
  });

  it("never lists a path that has no page (it would be a 404 in the sitemap)", () => {
    const appDir = resolve(__dirname, "../app");
    for (const path of getIndexablePaths()) {
      const page = resolve(appDir, `.${path}`, "page.tsx");
      expect(existsSync(page), `${path} needs ${page}`).toBe(true);
    }
  });
});
