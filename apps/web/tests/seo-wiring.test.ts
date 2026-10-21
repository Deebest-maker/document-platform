import { readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { getIndexablePaths } from "../lib/seo";

/**
 * Every route in app/ must take its robots rule, canonical and Open Graph data
 * from the shared helper, so one build setting controls the whole site and a
 * page cannot be added with its own hand-written (and possibly wrong) robots.
 */
type PageModule = { metadata?: Metadata };

const APP_DIR = resolve(__dirname, "../app");

/** Every `page.tsx` under app/, as { route, file }. */
function discoverPages(): { route: string; file: string }[] {
  return (readdirSync(APP_DIR, { recursive: true }) as string[])
    .map((entry) => entry.split(sep).join("/"))
    .filter((entry) => entry === "page.tsx" || entry.endsWith("/page.tsx"))
    .map((entry) => {
      const route = `/${entry.replace(/\/?page\.tsx$/, "")}`;
      return {
        route: route === "/" ? route : route.replace(/\/$/, ""),
        file: resolve(APP_DIR, entry),
      };
    });
}

async function loadMetadata(file: string): Promise<Metadata> {
  const loaded = (await import(/* @vite-ignore */ file)) as PageModule;
  return loaded.metadata ?? {};
}

async function loadAll(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const pages: Record<string, Metadata> = {};
  for (const { route, file } of discoverPages()) {
    pages[route] = await loadMetadata(file);
  }
  const layout = await loadMetadata(resolve(APP_DIR, "layout.tsx"));
  return { pages, layout };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("M6A: every route uses the shared SEO settings", () => {
  it("has a page for exactly the paths the sitemap can list", async () => {
    const { pages } = await loadAll({});
    expect(Object.keys(pages).sort()).toEqual([...getIndexablePaths()].sort());
  }, 60_000);

  it("is noindex everywhere, with no canonical, by default", async () => {
    const { pages, layout } = await loadAll({
      SITE_URL: "",
      SITE_INDEXING: "",
    });
    expect(layout.robots).toEqual({ index: false, follow: false });
    expect(layout.metadataBase).toBeUndefined();
    for (const [route, metadata] of Object.entries(pages)) {
      expect(metadata.robots, route).toEqual({ index: false, follow: false });
      expect(metadata.alternates, route).toBeUndefined();
      expect(metadata.openGraph, route).toBeUndefined();
    }
  }, 60_000);

  it("stays noindex when only the origin is set (staging)", async () => {
    const { pages, layout } = await loadAll({
      SITE_URL: "https://staging.example.com",
      SITE_INDEXING: "",
    });
    expect(layout.robots).toEqual({ index: false, follow: false });
    for (const [route, metadata] of Object.entries(pages)) {
      expect(metadata.robots, route).toEqual({ index: false, follow: false });
    }
  }, 60_000);

  it("is indexable with one canonical per route when switched on", async () => {
    const { pages, layout } = await loadAll({
      SITE_URL: "https://example.com",
      SITE_INDEXING: "on",
    });
    expect(layout.robots).toEqual({ index: true, follow: true });
    expect((layout.metadataBase as URL).origin).toBe("https://example.com");
    expect(layout.alternates).toBeUndefined();
    const canonicals = new Set<string>();
    for (const [route, metadata] of Object.entries(pages)) {
      expect(metadata.robots, route).toEqual({ index: true, follow: true });
      expect(metadata.alternates?.canonical, route).toBe(route);
      expect(metadata.openGraph, route).toMatchObject({ url: route });
      expect(metadata.description, route).toBeTruthy();
      canonicals.add(route);
    }
    expect(canonicals.size).toBe(Object.keys(pages).length);
  }, 60_000);

  it("ignores an invalid origin and stays off", async () => {
    const { pages } = await loadAll({
      SITE_URL: "https://example.com/some/path",
      SITE_INDEXING: "on",
    });
    for (const [route, metadata] of Object.entries(pages)) {
      expect(metadata.robots, route).toEqual({ index: false, follow: false });
    }
  }, 60_000);
});
