/**
 * Site-level SEO configuration (M6A, ADR-028).
 *
 * Two build-time settings, read once per build:
 *
 *   SITE_URL       the public origin, e.g. https://example.com (no path)
 *   SITE_INDEXING  the exact value "on" lets search engines index the site
 *
 * Indexing is OFF by default so a preview, staging or forgotten build can never
 * be indexed by accident. Indexing needs a valid origin: without one there is
 * no canonical address to point search engines at, so it stays off.
 */

export interface SiteConfig {
  /** Normalised origin (no trailing slash, no path), or undefined. */
  readonly origin: string | undefined;
  /** True only when SITE_INDEXING is exactly "on" and a valid origin exists. */
  readonly indexing: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

/** An absolute https origin, or http only for local development hosts. */
export function parseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  if (url.pathname !== "/") return undefined;
  return url.origin;
}

export function getSiteConfig(env: Env = process.env): SiteConfig {
  const origin = parseOrigin(env.SITE_URL);
  return {
    origin,
    indexing: env.SITE_INDEXING === "on" && origin !== undefined,
  };
}
