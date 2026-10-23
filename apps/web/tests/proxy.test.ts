import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "../proxy";

// proxy.ts adds the page Content-Security-Policy (M7C, ADR-034).

const request = (pathname: string) =>
  new NextRequest(new URL(pathname, "http://127.0.0.1:3100"));

describe("proxy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("adds a policy to a page in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CSP_MANIFEST_PATH", "/does/not/exist.json");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const policy = proxy(request("/about")).headers.get(
      "Content-Security-Policy",
    );
    expect(policy).toMatch(/^default-src 'none'; script-src 'self';/);
    error.mockRestore();
  });

  it("adds nothing in development, where hot reload needs inline scripts", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(
      proxy(request("/about")).headers.get("Content-Security-Policy"),
    ).toBeNull();
  });
});

describe("proxy matcher", () => {
  const [source] = config.matcher;
  const regexp = pathToRegexp(source);

  it.each([
    "/",
    "/about",
    "/merge-pdf",
    "/learn/some-guide",
    "/nope",
    "/robots.txt",
  ])("runs for %s", (pathname) => expect(regexp.test(pathname)).toBe(true));

  it.each([
    "/api/processor/jobs",
    "/_next/static/chunks/a.js",
    "/_next/image",
    "/vendor/pdfjs/6.3.289/manifest.json",
  ])("skips %s", (pathname) => expect(regexp.test(pathname)).toBe(false));
});
