#!/usr/bin/env node
/**
 * Post-build step for the page Content Security Policy (M7C, ADR-034).
 *
 * The site is prerendered at build time, so there is no per-request nonce to
 * put on the inline scripts Next.js writes into every page. Instead this step
 * reads each built page, hashes its inline scripts, and writes
 * .next/csp-manifest.json: for each route, the hashes its policy may name.
 * apps/web/proxy.ts turns that into the Content-Security-Policy header.
 *
 * It also audits the built pages for things the policy would refuse (inline
 * styles, event-handler attributes, javascript: links, frames, off-site
 * resources) and fails the build, so a mistake shows up here with a name
 * instead of as a broken page.
 *
 * Usage: node scripts/csp-manifest.mjs [distDir]   (default apps/web/.next)
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = "csp-manifest.json";

// Script types the browser runs. Anything else (application/json,
// application/ld+json, ...) is data and is not subject to script-src.
const EXECUTABLE_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
]);

const ATTRIBUTE =
  "(?:\\s+[^\\s\"'<>/=]+(?:\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s\"'=<>`]+))?)*";
const TAG = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(${ATTRIBUTE})\\s*/?>`, "g");
const ATTR =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributes(source) {
  const found = new Map();
  for (const match of source.matchAll(ATTR)) {
    found.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return found;
}

function hash(text) {
  return `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`;
}

/**
 * The inline scripts of a page that the browser would run, as the exact text
 * between the tags (which is what the hash is taken over).
 */
export function inlineScripts(html) {
  const scripts = [];
  const lower = html.toLowerCase();
  const open = new RegExp(`<script(${ATTRIBUTE})\\s*>`, "gi");
  for (const match of html.matchAll(open)) {
    const attrs = attributes(match[1]);
    if (attrs.has("src")) continue;
    const type = (attrs.get("type") ?? "").trim().toLowerCase();
    if (!EXECUTABLE_TYPES.has(type)) continue;
    const start = match.index + match[0].length;
    const end = lower.indexOf("</script", start);
    if (end === -1) throw new Error("A <script> element is never closed.");
    scripts.push(html.slice(start, end));
  }
  return scripts;
}

/** The hashes a page's policy lists, sorted and without repeats. */
export function scriptHashes(html) {
  return [...new Set(inlineScripts(html).map(hash))].sort();
}

const FORBIDDEN_TAGS = new Set(["iframe", "frame", "object", "embed", "base"]);
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "poster"];
// Elements that load or run something. A plain <a href> to another site is a
// link the visitor follows, not a resource the page loads, so it is fine.
const LOADING_TAGS = new Set([
  "script",
  "link",
  "img",
  "source",
  "video",
  "audio",
  "track",
  "form",
  "input",
  "button",
]);

/**
 * What in a built page the policy would refuse, as readable lines. A page with
 * an empty result needs no exception.
 *
 * `inlineStyles: true` is for the one page the build does not let us change
 * (see FRAMEWORK_ERROR_PAGE); everything else about it is still checked.
 */
export function auditPage(html, { inlineStyles = false } = {}) {
  const problems = [];
  // What a script says is code, not page markup; its opening tag still counts.
  const page = html.replace(
    new RegExp(`(<script${ATTRIBUTE}\\s*>)[\\s\\S]*?(</script\\s*>)`, "gi"),
    "$1$2",
  );
  if (!inlineStyles && /<style[\s>]/i.test(page))
    problems.push("an inline <style> element (use a stylesheet)");
  for (const match of page.matchAll(TAG)) {
    const name = match[1].toLowerCase();
    const attrs = attributes(match[2]);
    if (FORBIDDEN_TAGS.has(name)) problems.push(`a <${name}> element`);
    if (!inlineStyles && attrs.has("style"))
      problems.push(`a style="" attribute on <${name}> (use a class)`);
    for (const attr of attrs.keys())
      if (/^on[a-z]+$/.test(attr))
        problems.push(`an inline ${attr} handler on <${name}>`);
    for (const attr of URL_ATTRIBUTES) {
      const value = (attrs.get(attr) ?? "").trim();
      if (/^javascript:/i.test(value))
        problems.push(`a javascript: URL in ${attr} on <${name}>`);
      if (LOADING_TAGS.has(name) && /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value))
        problems.push(`<${name} ${attr}> loads from another origin: ${value}`);
    }
  }
  return [...new Set(problems)];
}

// Next.js builds a plain "500: This page couldn't load" page of its own and
// styles it inline. Our app/global-error.tsx does not replace it (it is a
// client error boundary, not this page), so its inline styles are the one
// exception. Under the policy it shows as unstyled text; it holds no
// document data and is only a fallback for a server failure (ADR-034).
export const FRAMEWORK_ERROR_PAGE = "/_global-error";

function* walk(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

function routeOf(file, appDirectory) {
  const relative = path
    .relative(appDirectory, file)
    .split(path.sep)
    .join("/")
    .replace(/\.html$/, "");
  return relative === "index" ? "/" : `/${relative}`;
}

/**
 * Build the manifest from a finished build.
 *
 * routes     route -> hashes for that page
 * fallback   hashes for any path that is not a known route: the 404 page and
 *            the page Next.js shows when the app itself fails
 */
export function buildManifest(distDirectory) {
  const appDirectory = path.join(distDirectory, "server", "app");
  const routes = {};
  const fallback = new Set();
  const problems = [];
  let pages = 0;
  for (const file of walk(appDirectory)) {
    const route = routeOf(file, appDirectory);
    const html = readFileSync(file, "utf8");
    const hashes = scriptHashes(html);
    const audit = auditPage(html, {
      inlineStyles: route === FRAMEWORK_ERROR_PAGE,
    });
    for (const problem of audit) problems.push(`${route}: ${problem}`);
    if (route === "/_not-found" || route === FRAMEWORK_ERROR_PAGE) {
      for (const value of hashes) fallback.add(value);
      continue;
    }
    routes[route] = hashes;
    pages += 1;
  }
  if (pages === 0) problems.push("no built pages found under " + appDirectory);
  if (fallback.size === 0)
    problems.push("the 404 and error pages were not found in the build");
  return {
    manifest: {
      version: MANIFEST_VERSION,
      routes: Object.fromEntries(
        Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)),
      ),
      fallback: [...fallback].sort(),
    },
    problems,
  };
}

export function writeManifest(distDirectory) {
  const { manifest, problems } = buildManifest(distDirectory);
  if (problems.length === 0)
    writeFileSync(
      path.join(distDirectory, MANIFEST_FILE),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  return { manifest, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const distDirectory = path.resolve(
    process.argv[2] ?? path.join(process.cwd(), ".next"),
  );
  const { manifest, problems } = writeManifest(distDirectory);
  if (problems.length > 0) {
    console.error(
      "The built pages break the Content Security Policy (ADR-034):\n" +
        problems.map((line) => `  - ${line}`).join("\n"),
    );
    process.exit(1);
  }
  const count = Object.keys(manifest.routes).length;
  console.log(
    `Content Security Policy manifest written: ${count} pages, ` +
      `${new Set(Object.values(manifest.routes).flat()).size} distinct inline scripts.`,
  );
}
