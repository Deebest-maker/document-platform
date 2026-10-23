import { readFileSync } from "node:fs";
import path from "node:path";
import type { CspManifest } from "../../../../scripts/csp-manifest.mjs";
import { documentPolicy } from "./policy.mjs";

/**
 * Which Content-Security-Policy a page gets (M7C, ADR-034).
 *
 * The hashes come from .next/csp-manifest.json, written after the build by
 * scripts/csp-manifest.mjs from the pages Next.js actually produced. If that
 * file is missing or unreadable the policy names no inline script at all:
 * the pages then fail to start, which is loud, instead of running under a
 * weaker policy, which would be silent.
 */

export const MANIFEST_VERSION = 1;

export type Manifest = Pick<CspManifest, "routes" | "fallback">;

type Env = Readonly<Record<string, string | undefined>>;

export function manifestPath(env: Env = process.env): string {
  return (
    env.CSP_MANIFEST_PATH ??
    path.join(process.cwd(), ".next", "csp-manifest.json")
  );
}

/** Read and check a manifest; undefined when it cannot be trusted. */
export function readManifest(file: string): Manifest | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parseManifest(parsed);
  } catch {
    return undefined;
  }
}

export function parseManifest(value: unknown): Manifest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { version, routes, fallback } = value as Record<string, unknown>;
  if (version !== MANIFEST_VERSION) return undefined;
  if (typeof routes !== "object" || routes === null) return undefined;
  if (!isHashList(fallback)) return undefined;
  const checked: Record<string, string[]> = {};
  for (const [route, hashes] of Object.entries(routes)) {
    if (!isHashList(hashes)) return undefined;
    checked[route] = hashes;
  }
  return { routes: checked, fallback };
}

function isHashList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" && /^sha256-[A-Za-z0-9+/]+=*$/.test(item),
    )
  );
}

/**
 * The route a request path belongs to: decoded, without a trailing slash.
 * Routes are case sensitive in Next.js (`/About` is a 404), so case is kept.
 */
export function routeKey(pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  return decoded.length > 1 ? decoded.replace(/\/+$/, "") || "/" : "/";
}

/**
 * The policy for a request path. A path that is not a known page (a 404) gets
 * the policy of the 404 page.
 */
export function policyFor(
  manifest: Manifest | undefined,
  pathname: string,
): string {
  if (!manifest) return documentPolicy([]);
  const key = routeKey(pathname);
  const hashes =
    (key !== undefined && Object.hasOwn(manifest.routes, key)
      ? manifest.routes[key]
      : undefined) ?? manifest.fallback;
  return documentPolicy(hashes.map((hash) => `'${hash}'`));
}

let cached: { file: string; manifest: Manifest | undefined } | undefined;

/** The manifest of the running build, read once. */
export function currentManifest(env: Env = process.env): Manifest | undefined {
  const file = manifestPath(env);
  if (cached?.file !== file) {
    cached = { file, manifest: readManifest(file) };
    if (!cached.manifest)
      console.error(
        "Content Security Policy manifest is missing or invalid; pages will not start. Run the build to the end (scripts/csp-manifest.mjs).",
      );
  }
  return cached.manifest;
}
