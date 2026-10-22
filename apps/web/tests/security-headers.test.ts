import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import {
  PERMISSIONS_POLICY,
  SECURITY_HEADERS,
  WORKER_POLICY,
  documentPolicy,
  hashSource,
} from "../lib/security/policy.mjs";

// The headers the site sends (M7C, ADR-034): the policy text itself, and which
// responses get which header.

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values];
    }),
  );

describe("documentPolicy", () => {
  const policy = documentPolicy(["'sha256-abc='"]);
  const d = directives(policy);

  it("refuses everything it does not name", () => {
    expect(d["default-src"]).toEqual(["'none'"]);
  });

  it("allows scripts from this origin and the named inline hashes only", () => {
    expect(d["script-src"]).toEqual(["'self'", "'sha256-abc='"]);
  });

  it("never allows inline or evaluated code, or any other origin", () => {
    expect(policy).not.toMatch(/unsafe-/);
    expect(policy).not.toMatch(/wasm-unsafe-eval/);
    expect(policy).not.toMatch(/strict-dynamic/);
    expect(policy).not.toMatch(/https?:|\*/);
  });

  it("limits styles, fonts, connections, workers and manifests to this origin", () => {
    for (const name of [
      "style-src",
      "font-src",
      "connect-src",
      "worker-src",
      "manifest-src",
    ])
      expect(d[name], name).toEqual(["'self'"]);
  });

  it("lets previews and results use in-memory images, and no other origin's", () => {
    expect(d["img-src"]).toEqual(["'self'", "blob:", "data:"]);
  });

  it("forbids plug-ins, a <base>, form posts and framing", () => {
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'none'"]);
    expect(d["form-action"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
  });

  it("names no inline script when none is given", () => {
    expect(directives(documentPolicy([]))["script-src"]).toEqual(["'self'"]);
  });
});

describe("hashSource", () => {
  it("is the quoted SHA-256 of the text, as browsers expect", () => {
    // sha256("") in base64
    expect(hashSource("")).toBe(
      "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='",
    );
  });
});

describe("WORKER_POLICY", () => {
  const d = directives(WORKER_POLICY);

  it("lets a worker run this origin's scripts and WebAssembly, nothing else", () => {
    expect(d["default-src"]).toEqual(["'none'"]);
    expect(d["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(WORKER_POLICY).not.toMatch(/unsafe-inline|[^-]unsafe-eval/);
  });

  it("lets a worker reach only this origin, so a document cannot be sent away", () => {
    expect(d["connect-src"]).toEqual(["'self'"]);
    expect(WORKER_POLICY).not.toMatch(/https?:|\*|blob:|data:/);
  });
});

describe("the plain headers", () => {
  const byKey = Object.fromEntries(
    SECURITY_HEADERS.map((h) => [h.key, h.value]),
  );

  it("are the set the architecture asks for", () => {
    expect(byKey).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    expect(Object.keys(byKey)).toContain("Permissions-Policy");
  });

  it("do not set HSTS, which belongs to the HTTPS edge, or a COEP that would block CDN assets", () => {
    expect(Object.keys(byKey)).not.toContain("Strict-Transport-Security");
    expect(Object.keys(byKey)).not.toContain("Cross-Origin-Embedder-Policy");
  });

  it("switch off every powerful feature the site does not use", () => {
    for (const feature of [
      "camera",
      "microphone",
      "geolocation",
      "payment",
      "usb",
    ])
      expect(PERMISSIONS_POLICY).toContain(`${feature}=()`);
    expect(PERMISSIONS_POLICY).not.toMatch(/=\*|=\(self/);
  });
});

describe("next.config headers()", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function rules() {
    return (await nextConfig.headers!()) ?? [];
  }
  const matches = (source: string, pathname: string) =>
    pathToRegexp(source).test(pathname);
  const sent = async (pathname: string) => {
    const keys: string[] = [];
    for (const rule of await rules())
      if (matches(rule.source, pathname))
        keys.push(...rule.headers.map((h) => h.key));
    return keys;
  };

  it("puts the plain headers on pages, scripts, data files and error pages", async () => {
    for (const pathname of [
      "/",
      "/merge-pdf",
      "/learn/some-guide",
      "/nope",
      "/robots.txt",
      "/_next/static/chunks/a.js",
      "/vendor/pdfjs/6.3.289/manifest.json",
    ])
      expect(await sent(pathname), pathname).toContain(
        "X-Content-Type-Options",
      );
  });

  it("leaves /api/processor alone, so the processor's own headers are not doubled", async () => {
    for (const pathname of [
      "/api/processor/jobs",
      "/api/processor/jobs/abc/output",
      "/api/processor",
    ])
      expect(await sent(pathname), pathname).not.toContain(
        "X-Content-Type-Options",
      );
    // ... but a page or file whose name only starts the same way is covered.
    for (const pathname of ["/api/processors", "/apiary", "/api/other"])
      expect(await sent(pathname), pathname).toContain(
        "X-Content-Type-Options",
      );
  });

  it("puts the worker policy on built files in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const policyRules = (await rules()).filter((rule) =>
      rule.headers.some((h) => h.key === "Content-Security-Policy"),
    );
    expect(policyRules).toHaveLength(1);
    expect(policyRules[0].headers[0].value).toBe(WORKER_POLICY);
    expect(matches(policyRules[0].source, "/_next/static/chunks/a.js")).toBe(
      true,
    );
    // Pages get their own policy from the proxy, never this one.
    expect(matches(policyRules[0].source, "/")).toBe(false);
    expect(matches(policyRules[0].source, "/merge-pdf")).toBe(false);
  });

  it("does not put it on the development server, whose workers need eval", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const all = (await rules()).flatMap((rule) => rule.headers);
    expect(all.map((h) => h.key)).not.toContain("Content-Security-Policy");
  });

  it("still marks an unindexed build noindex", async () => {
    vi.stubEnv("SITE_INDEXING", "");
    expect(await sent("/about")).toContain("X-Robots-Tag");
  });
});
