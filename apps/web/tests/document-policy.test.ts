import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANIFEST_VERSION,
  currentManifest,
  manifestPath,
  parseManifest,
  policyFor,
  readManifest,
  routeKey,
} from "../lib/security/document-policy";
import { MANIFEST_VERSION as GENERATOR_VERSION } from "../../../scripts/csp-manifest.mjs";

const A = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const B = "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const C = "sha256-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=";

const manifest = {
  routes: { "/": [A], "/about": [B], "/learn/guide": [A, B] },
  fallback: [C],
};

describe("the manifest version", () => {
  it("is the version the build step writes", () => {
    expect(MANIFEST_VERSION).toBe(GENERATOR_VERSION);
  });
});

describe("parseManifest", () => {
  const good = { version: MANIFEST_VERSION, ...manifest };

  it("accepts what the build step writes", () => {
    expect(parseManifest(good)).toEqual(manifest);
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["another version", { ...good, version: 99 }],
    ["no routes", { version: 1, fallback: [C] }],
    ["no fallback", { version: 1, routes: {} }],
    ["a non-hash entry", { ...good, routes: { "/": ["'unsafe-inline'"] } }],
    ["an injected directive", { ...good, fallback: [`${A}'; script-src *`] }],
    ["a routes entry that is not a list", { ...good, routes: { "/": A } }],
  ])("rejects %s", (_name, value) => {
    expect(parseManifest(value)).toBeUndefined();
  });
});

describe("routeKey", () => {
  it.each([
    ["/", "/"],
    ["/about", "/about"],
    ["/about/", "/about"],
    ["/learn/guide//", "/learn/guide"],
    ["/learn/%67uide", "/learn/guide"],
    ["//", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(routeKey(input)).toBe(expected);
  });

  it("keeps case, because /About is a 404 and not /about", () => {
    expect(routeKey("/About")).toBe("/About");
  });

  it("gives up on a malformed escape", () => {
    expect(routeKey("/%E0%A4%A")).toBeUndefined();
  });
});

describe("policyFor", () => {
  const scripts = (policy: string) =>
    /script-src ([^;]*)/.exec(policy)?.[1].split(" ");

  it("lists the hashes of the page asked for", () => {
    expect(scripts(policyFor(manifest, "/about"))).toEqual([
      "'self'",
      `'${B}'`,
    ]);
    expect(scripts(policyFor(manifest, "/learn/guide/"))).toEqual([
      "'self'",
      `'${A}'`,
      `'${B}'`,
    ]);
  });

  it("gives any other path the 404 page's scripts", () => {
    expect(scripts(policyFor(manifest, "/nope"))).toEqual(["'self'", `'${C}'`]);
    expect(scripts(policyFor(manifest, "/About"))).toEqual([
      "'self'",
      `'${C}'`,
    ]);
    expect(scripts(policyFor(manifest, "/%E0%A4%A"))).toEqual([
      "'self'",
      `'${C}'`,
    ]);
  });

  it("does not treat object keys as routes", () => {
    for (const hostile of ["/__proto__", "/constructor", "/toString"])
      expect(scripts(policyFor(manifest, hostile))).toEqual([
        "'self'",
        `'${C}'`,
      ]);
  });

  it("names no inline script at all when there is no manifest", () => {
    expect(scripts(policyFor(undefined, "/"))).toEqual(["'self'"]);
  });
});

describe("loading the manifest", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "csp-load-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uses CSP_MANIFEST_PATH when set and .next otherwise", () => {
    expect(manifestPath({ CSP_MANIFEST_PATH: "/x/y.json" })).toBe("/x/y.json");
    expect(manifestPath({})).toBe(
      path.join(process.cwd(), ".next", "csp-manifest.json"),
    );
  });

  it("reads a good file and refuses a missing, empty or tampered one", () => {
    const file = path.join(dir, "m.json");
    writeFileSync(file, JSON.stringify({ version: 1, ...manifest }));
    expect(readManifest(file)).toEqual(manifest);
    expect(readManifest(path.join(dir, "missing.json"))).toBeUndefined();
    writeFileSync(file, "");
    expect(readManifest(file)).toBeUndefined();
    writeFileSync(file, "{not json");
    expect(readManifest(file)).toBeUndefined();
  });

  it("says once, loudly, that the manifest is unusable", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { CSP_MANIFEST_PATH: path.join(dir, "absent.json") };
    expect(currentManifest(env)).toBeUndefined();
    expect(currentManifest(env)).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/will not start/);
  });
});
