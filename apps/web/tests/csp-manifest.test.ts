import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  FRAMEWORK_ERROR_PAGE,
  MANIFEST_FILE,
  MANIFEST_VERSION,
  auditPage,
  buildManifest,
  inlineScripts,
  scriptHashes,
  writeManifest,
} from "../../../scripts/csp-manifest.mjs";

// scripts/csp-manifest.mjs runs after `next build`. It hashes the inline
// scripts of every built page and refuses pages the policy would break
// (ADR-034). These tests feed it small pages and small fake builds.

const script = path.resolve(
  import.meta.dirname,
  "../../../scripts/csp-manifest.mjs",
);
const made: string[] = [];
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

const sha = (text: string) =>
  `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`;
const page = (body: string, head = "") =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

function fakeBuild(pages: Record<string, string>) {
  const dist = mkdtempSync(path.join(tmpdir(), "csp-build-"));
  made.push(dist);
  for (const [file, html] of Object.entries(pages)) {
    const target = path.join(dist, "server", "app", file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, html);
  }
  return dist;
}

describe("inlineScripts / scriptHashes", () => {
  it("returns the exact text of each inline script and skips external ones", () => {
    const html = page(
      '<script src="/a.js" async></script><script>one()</script>' +
        '<script id="_R_">two("<b>")</script>',
    );
    expect(inlineScripts(html)).toEqual(["one()", 'two("<b>")']);
  });

  it("hashes the text byte for byte, whitespace included", () => {
    const html = page("<script>\n  go();\n</script>");
    expect(scriptHashes(html)).toEqual([sha("\n  go();\n")]);
  });

  it("hashes module scripts but not data blocks (JSON, JSON-LD)", () => {
    const html = page(
      '<script type="module">import("/x.js")</script>' +
        '<script type="application/ld+json">{"@type":"Thing"}</script>' +
        '<script type="application/json">{"a":1}</script>',
    );
    expect(inlineScripts(html)).toEqual(['import("/x.js")']);
  });

  it("is not fooled by upper case tags, odd spacing or a > inside an attribute", () => {
    const html = page(
      '<SCRIPT  data-x="a>b"  >upper()</SCRIPT><script\n>plain()</script >',
    );
    expect(inlineScripts(html)).toEqual(["upper()", "plain()"]);
  });

  it("lists each distinct script once, in a stable order", () => {
    const html = page(
      "<script>b()</script><script>a()</script><script>b()</script>",
    );
    const hashes = scriptHashes(html);
    expect(hashes).toHaveLength(2);
    expect(hashes).toEqual([...hashes].sort());
  });

  it("refuses a script that is never closed rather than guessing", () => {
    expect(() => inlineScripts(page("<script>never()"))).toThrow(
      /never closed/,
    );
  });
});

describe("auditPage", () => {
  const cases: [string, string, RegExp][] = [
    ["a style attribute", '<p style="color:red">x</p>', /style="" attribute/],
    ["an inline style element", "<style>p{color:red}</style>", /<style>/],
    ["an event handler", '<img src="/a.png" onerror="x()">', /onerror handler/],
    [
      "a javascript: link",
      '<a href="javascript:x()">go</a>',
      /javascript: URL/,
    ],
    ["an iframe", '<iframe src="/x"></iframe>', /<iframe>/],
    ["an object", '<object data="/x"></object>', /<object>/],
    ["a base element", '<base href="https://evil.example/">', /<base>/],
    [
      "a script from another origin",
      '<script src="https://cdn.example/x.js"></script>',
      /loads from another origin/,
    ],
    [
      "a protocol-relative image",
      '<img src="//cdn.example/x.png">',
      /loads from another origin/,
    ],
    [
      "a stylesheet from another origin",
      '<link rel="stylesheet" href="https://fonts.example/css">',
      /loads from another origin/,
    ],
    [
      "a form posting elsewhere",
      '<form action="https://evil.example/"></form>',
      /loads from another origin/,
    ],
  ];

  it.each(cases)("reports %s", (_name, body, expected) => {
    expect(auditPage(page(body)).join("\n")).toMatch(expected);
  });

  it("accepts an ordinary page with links out, own files and inline scripts", () => {
    const html = page(
      '<a href="https://example.org/">a link the visitor follows</a>' +
        '<img src="/a.png" alt=""><script>boot()</script>' +
        '<script src="/_next/static/a.js"></script>',
      '<link rel="stylesheet" href="/_next/static/a.css">',
    );
    expect(auditPage(html)).toEqual([]);
  });

  it("does not read the inside of a script as page markup", () => {
    const html = page(
      '<script>self.__next_f.push([1,"<style>x</style><p style=\\"a\\" onclick=\\"b()\\">"])</script>',
    );
    expect(auditPage(html)).toEqual([]);
  });

  it("can set aside inline styles only, for the page we cannot change", () => {
    const html = page(
      '<style>p{}</style><p style="a">x</p><img onerror="x()">',
    );
    const lines = auditPage(html, { inlineStyles: true });
    expect(lines.join("\n")).toMatch(/onerror/);
    expect(lines.join("\n")).not.toMatch(/style/);
  });
});

describe("buildManifest", () => {
  const home = page("<script>home()</script><script>shared()</script>");
  const about = page("<script>about()</script><script>shared()</script>");
  const notFound = page("<script>missing()</script>");
  const globalError = page(
    '<style>p{}</style><p style="a">500</p><script>failed()</script>',
  );

  it("maps every page to the hashes of its own scripts", () => {
    const dist = fakeBuild({
      "index.html": home,
      "about.html": about,
      "learn/guide.html": page("<script>guide()</script>"),
      "_not-found.html": notFound,
      "_global-error.html": globalError,
    });
    const { manifest, problems } = buildManifest(dist);
    expect(problems).toEqual([]);
    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(Object.keys(manifest.routes)).toEqual([
      "/",
      "/about",
      "/learn/guide",
    ]);
    expect(manifest.routes["/"]).toEqual(
      [sha("home()"), sha("shared()")].sort(),
    );
    expect(manifest.routes["/learn/guide"]).toEqual([sha("guide()")]);
  });

  it("gives unknown paths the 404 and error pages' scripts, and nothing more", () => {
    const dist = fakeBuild({
      "index.html": home,
      "_not-found.html": notFound,
      "_global-error.html": globalError,
    });
    const { manifest } = buildManifest(dist);
    expect(manifest.fallback).toEqual(
      [sha("missing()"), sha("failed()")].sort(),
    );
    expect(manifest.routes).not.toHaveProperty("/_not-found");
    expect(manifest.routes).not.toHaveProperty(FRAMEWORK_ERROR_PAGE);
  });

  it("accepts the framework error page's inline styles but nothing else about it", () => {
    const clean = fakeBuild({
      "index.html": home,
      "_not-found.html": notFound,
      "_global-error.html": globalError,
    });
    expect(buildManifest(clean).problems).toEqual([]);
    const handler = fakeBuild({
      "index.html": home,
      "_not-found.html": notFound,
      "_global-error.html": page('<button onclick="x()">retry</button>'),
    });
    expect(buildManifest(handler).problems.join("\n")).toMatch(/onclick/);
  });

  it("names the page and the problem for any other inline style", () => {
    const dist = fakeBuild({
      "index.html": home,
      "about.html": page('<p style="margin:0">x</p>'),
      "_not-found.html": notFound,
      "_global-error.html": globalError,
    });
    const { problems } = buildManifest(dist);
    expect(problems).toEqual([
      '/about: a style="" attribute on <p> (use a class)',
    ]);
  });

  it("reports an empty build and a build without its 404 page", () => {
    expect(buildManifest(fakeBuild({})).problems.join("\n")).toMatch(
      /no built pages/,
    );
    const noError = fakeBuild({ "index.html": home });
    expect(buildManifest(noError).problems.join("\n")).toMatch(/404 and error/);
  });

  it("writes the file only when the pages are clean", () => {
    const good = fakeBuild({
      "index.html": home,
      "_not-found.html": notFound,
      "_global-error.html": globalError,
    });
    expect(writeManifest(good).problems).toEqual([]);
    const written = JSON.parse(
      readFileSync(path.join(good, MANIFEST_FILE), "utf8"),
    );
    expect(written.routes["/"]).toEqual(
      [sha("home()"), sha("shared()")].sort(),
    );

    const bad = fakeBuild({
      "index.html": page('<p style="a">x</p>'),
      "_not-found.html": notFound,
      "_global-error.html": globalError,
    });
    expect(writeManifest(bad).problems).not.toEqual([]);
    expect(() => readFileSync(path.join(bad, MANIFEST_FILE))).toThrow();
  });
});

describe("the command", () => {
  it("exits 0 and writes the manifest for a clean build", () => {
    const dist = fakeBuild({
      "index.html": page("<script>home()</script>"),
      "_not-found.html": page("<script>missing()</script>"),
      "_global-error.html": page("<script>failed()</script>"),
    });
    const result = spawnSync("node", [script, dist], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/1 pages/);
    expect(readFileSync(path.join(dist, MANIFEST_FILE), "utf8")).toContain(
      sha("home()"),
    );
  });

  it("exits 1 and says what is wrong when a page would break the policy", () => {
    const dist = fakeBuild({
      "index.html": page('<img src="/a.png" onerror="x()">'),
      "_not-found.html": page("<script>missing()</script>"),
      "_global-error.html": page("<script>failed()</script>"),
    });
    const result = spawnSync("node", [script, dist], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\/: an inline onerror handler on <img>/);
  });
});
