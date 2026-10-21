import { describe, expect, it } from "vitest";
import { getSiteConfig, parseOrigin } from "../lib/site";

describe("M6A site configuration", () => {
  it("is off and has no origin by default", () => {
    expect(getSiteConfig({})).toEqual({ origin: undefined, indexing: false });
  });

  it("accepts a plain https origin and normalises it", () => {
    expect(parseOrigin("https://example.com")).toBe("https://example.com");
    expect(parseOrigin("https://example.com/")).toBe("https://example.com");
    expect(parseOrigin("  https://Example.COM  ")).toBe("https://example.com");
    expect(parseOrigin("https://example.com:8443")).toBe(
      "https://example.com:8443",
    );
  });

  it("allows http only for local development hosts", () => {
    expect(parseOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(parseOrigin("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(parseOrigin("http://[::1]:3000")).toBe("http://[::1]:3000");
    expect(parseOrigin("http://example.com")).toBeUndefined();
    expect(parseOrigin("http://localhost.example.com")).toBeUndefined();
  });

  it.each([
    "",
    "   ",
    "example.com",
    "//example.com",
    "ftp://example.com",
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://example.com/blog",
    "https://example.com/?a=1",
    "https://example.com/#top",
    "https://user:secret@example.com",
    "not a url",
  ])("rejects %j", (value) => {
    expect(parseOrigin(value)).toBeUndefined();
  });

  it("turns indexing on only for the exact value 'on' with a valid origin", () => {
    const origin = "https://example.com";
    expect(getSiteConfig({ SITE_URL: origin, SITE_INDEXING: "on" })).toEqual({
      origin,
      indexing: true,
    });
    for (const value of ["ON", "On", "true", "1", "yes", " on", "off", ""]) {
      expect(
        getSiteConfig({ SITE_URL: origin, SITE_INDEXING: value }).indexing,
      ).toBe(false);
    }
  });

  it("keeps indexing off without a valid origin, even when asked", () => {
    expect(getSiteConfig({ SITE_INDEXING: "on" }).indexing).toBe(false);
    expect(
      getSiteConfig({ SITE_URL: "https://example.com/x", SITE_INDEXING: "on" }),
    ).toEqual({ origin: undefined, indexing: false });
    expect(
      getSiteConfig({ SITE_URL: "http://example.com", SITE_INDEXING: "on" })
        .indexing,
    ).toBe(false);
  });

  it("keeps the origin when indexing is off (staging canonical, still noindex)", () => {
    expect(getSiteConfig({ SITE_URL: "https://staging.example.com" })).toEqual({
      origin: "https://staging.example.com",
      indexing: false,
    });
  });
});
