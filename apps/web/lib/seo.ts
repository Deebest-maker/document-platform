/**
 * Search-engine metadata, robots rules and the sitemap (M6A, ADR-028).
 *
 * Everything here is pure and takes the site config as a parameter so the
 * indexing-on and indexing-off behaviour can both be tested. Pages call
 * `seoMetadata` / `toolMetadata` and never write `robots` by hand.
 */

import type { Metadata, MetadataRoute } from "next";
import {
  getToolMetadata,
  getToolPath,
  tools,
  type ToolDefinition,
} from "@document-platform/tool-registry";
import { getSiteConfig, type SiteConfig } from "./site";

export const SITE_NAME = "Document & File Platform";
export const DEFAULT_TITLE = `${SITE_NAME} — Preview`;
export const DEFAULT_DESCRIPTION =
  "Merge, split, or organize PDFs on your device and explore the planned document toolkit.";

/** Static pages that exist for visitors and are meant to be found by search. */
export const STATIC_INDEXABLE_PATHS = [
  "/",
  "/tools",
  "/about",
  "/privacy",
  "/terms",
  "/contact",
] as const;

export function siteRobots(config: SiteConfig = getSiteConfig()) {
  return config.indexing
    ? { index: true, follow: true }
    : { index: false, follow: false };
}

interface PageSeo {
  /** Omit to inherit the site default title (the home page). */
  readonly title?: string;
  readonly description: string;
  /** Site-relative path, e.g. "/merge-pdf". */
  readonly path: string;
}

/**
 * Title, description, robots and, when the site origin is known, the canonical
 * address and Open Graph data. The canonical URL is the clean path: query
 * strings and fragments never become indexable variants.
 */
export function seoMetadata(
  page: PageSeo,
  config: SiteConfig = getSiteConfig(),
): Metadata {
  const metadata: Metadata = {
    description: page.description,
    robots: siteRobots(config),
  };
  if (page.title) metadata.title = page.title;
  if (config.origin) {
    metadata.alternates = { canonical: page.path };
    metadata.openGraph = {
      type: "website",
      siteName: SITE_NAME,
      title: page.title ? `${page.title} | ${SITE_NAME}` : DEFAULT_TITLE,
      description: page.description,
      url: page.path,
    };
  }
  return metadata;
}

export function toolMetadata(
  tool: ToolDefinition,
  config: SiteConfig = getSiteConfig(),
): Metadata {
  const { title, description } = getToolMetadata(tool);
  return seoMetadata({ title, description, path: getToolPath(tool) }, config);
}

/** Paths that are published for search: finished tools only, no fragments. */
export function getIndexablePaths(
  records: readonly ToolDefinition[] = tools,
): readonly string[] {
  const toolPaths = records
    .filter((tool) => tool.availability === "available")
    .map(getToolPath);
  return [...new Set([...STATIC_INDEXABLE_PATHS, ...toolPaths])];
}

export function buildRobots(
  config: SiteConfig = getSiteConfig(),
): MetadataRoute.Robots {
  if (!config.indexing) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${config.origin}/sitemap.xml`,
  };
}

/**
 * Empty unless indexing is on. No lastModified, priority or change frequency:
 * we have no real modification dates and search engines ignore the others.
 */
export function buildSitemap(
  config: SiteConfig = getSiteConfig(),
  records: readonly ToolDefinition[] = tools,
): MetadataRoute.Sitemap {
  if (!config.indexing || !config.origin) return [];
  const origin = config.origin;
  // The home page is the bare origin: Next renders its canonical link without
  // a trailing slash, and the sitemap must list exactly the canonical address.
  return getIndexablePaths(records).map((path) => ({
    url: path === "/" ? origin : `${origin}${path}`,
  }));
}
