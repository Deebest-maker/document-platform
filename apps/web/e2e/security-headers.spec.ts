import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test as plain, type BrowserContext } from "@playwright/test";
import { expect, test } from "./fixtures";

// M7C (ADR-034): what the server really sends. These tests read the built
// output and the live responses, and do not use the policy code itself to
// decide what is right: the hashes are taken from the HTML the server returns
// and compared with the header the same response carries.

const APP_OUTPUT = path.resolve(import.meta.dirname, "../.next/server/app");

// Every prerendered page, from the build rather than from a list in this file,
// so a new page is checked without anyone remembering to add it.
function builtRoutes(): string[] {
  return (readdirSync(APP_OUTPUT, { recursive: true }) as string[])
    .map((entry) => entry.split(path.sep).join("/"))
    .filter((entry) => entry.endsWith(".html"))
    .map((entry) => entry.replace(/\.html$/, ""))
    .filter((entry) => !entry.startsWith("_"))
    .map((entry) => (entry === "index" ? "/" : `/${entry}`))
    .sort();
}

// Scripts a browser would run: inline, and not a data block.
function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const match of html.matchAll(
    /<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/gi,
  )) {
    const attrs = match.groups!.attrs;
    if (/\ssrc=/i.test(attrs)) continue;
    if (/\stype="(?!module")/i.test(attrs)) continue;
    hashes.add(
      `'sha256-${createHash("sha256").update(match.groups!.body).digest("base64")}'`,
    );
  }
  return [...hashes].sort();
}

function scriptSources(policy: string): string[] {
  const directive = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("script-src "));
  return directive ? directive.split(" ").slice(1) : [];
}

const PLAIN_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
};

test("there are pages to check", () => {
  // Guards the guard: an empty list would make every test below pass.
  expect(builtRoutes().length).toBeGreaterThan(20);
  expect(builtRoutes()).toEqual(
    expect.arrayContaining(["/", "/merge-pdf", "/word-to-pdf", "/privacy"]),
  );
});

test("every page's policy names exactly the inline scripts that page contains", async ({
  request,
}) => {
  for (const route of builtRoutes()) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    const policy = response.headers()["content-security-policy"];
    expect(policy, `${route} has a policy`).toBeTruthy();
    const wanted = inlineScriptHashes(await response.text());
    expect(wanted.length, `${route} has inline scripts`).toBeGreaterThan(0);
    expect(scriptSources(policy), route).toEqual(["'self'", ...wanted]);
  }
});

test("every page's policy is strict and complete", async ({ request }) => {
  for (const route of builtRoutes()) {
    const response = await request.get(route);
    const policy = response.headers()["content-security-policy"];
    expect(policy, route).toContain("default-src 'none'");
    expect(policy, route).toContain("frame-ancestors 'none'");
    expect(policy, route).toContain("object-src 'none'");
    expect(policy, route).toContain("base-uri 'none'");
    expect(policy, route).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:/);
  }
});

test("every page sends the plain security headers", async ({ request }) => {
  for (const route of builtRoutes()) {
    const headers = (await request.get(route)).headers();
    for (const [name, value] of Object.entries(PLAIN_HEADERS))
      expect(headers[name], `${route} ${name}`).toBe(value);
    expect(headers["permissions-policy"], route).toContain("camera=()");
    expect(headers["permissions-policy"], route).toContain("microphone=()");
    expect(headers["permissions-policy"], route).toContain("geolocation=()");
  }
});

test("a path that is not a page gets a 404 page whose own scripts are allowed", async ({
  request,
}) => {
  for (const missing of ["/no-such-page", "/About", "/merge-pdf/extra"]) {
    const response = await request.get(missing);
    expect(response.status(), missing).toBe(404);
    const body = await response.text();
    expect(body, missing).toContain("This page does not exist");
    // The policy for an unknown path also covers the framework's error page,
    // so it may name more hashes than the 404 page needs, never fewer.
    const sources = scriptSources(
      response.headers()["content-security-policy"],
    );
    expect(sources[0], missing).toBe("'self'");
    expect(sources, missing).toEqual(
      expect.arrayContaining(inlineScriptHashes(body)),
    );
    expect(sources.length, missing).toBeLessThanOrEqual(1 + 6);
    expect(response.headers()["x-content-type-options"], missing).toBe(
      "nosniff",
    );
  }
});

test("script files carry the worker policy, which keeps a worker's data on this origin", async ({
  request,
  page,
}) => {
  await page.goto("/split-pdf");
  const chunk = await page.evaluate(() =>
    Array.from(document.scripts)
      .map((script) => script.src)
      .find((src) => src.includes("/_next/static/chunks/"))!,
  );
  const response = await request.get(chunk);
  const policy = response.headers()["content-security-policy"];
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(policy).not.toMatch(/unsafe-inline|[^-]unsafe-eval|https?:|\*/);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("data files carry the plain headers", async ({ request }) => {
  const response = await request.get("/vendor/pdfjs/6.3.289/manifest.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
});

// Not under the request audit: the test itself visits a second origin.
//
// A real second site is needed. A page that Playwright makes up for a made-up
// address is treated by Chromium as public, and Chromium then refuses to let it
// reach a server on this machine for an unrelated reason, so such a test passes
// whether or not the headers work. Here the framing page is a small server of
// its own on `localhost`, a different site from the app's 127.0.0.1.
//
// What shows a refused frame also differs by engine (Firefox swaps in a browser
// page the test cannot look into), so the test does not look inside the frame.
// A document that is shown loads its own scripts and styles; one the browser
// refuses to show loads nothing. The control runs the same frame with the
// framing headers removed on the way in: it must load the files, which proves
// both that the frame works and that the test would notice.
plain(
  "a page cannot be shown inside another site",
  async ({ browser, context, baseURL }) => {
    const app = new URL(baseURL!);
    const appFiles = (requests: string[]) =>
      requests.filter((url) => {
        const { origin, pathname } = new URL(url);
        return origin === app.origin && /^\/(_next|vendor)\//.test(pathname);
      });

    const framer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<iframe src="${app.origin}/about"></iframe>`);
    });
    await new Promise<void>((resolve) => framer.listen(0, resolve));
    const framerUrl = `http://localhost:${(framer.address() as AddressInfo).port}/`;

    try {
      const show = async (target: BrowserContext) => {
        const requested: string[] = [];
        target.on("request", (request) => requested.push(request.url()));
        const page = await target.newPage();
        await page.goto(framerUrl);
        // Long enough for a frame that was shown to fetch its scripts and styles.
        await page.waitForTimeout(2000);
        return requested;
      };

      // Control: the same page with the headers that forbid framing removed.
      const control = await browser.newContext();
      await control.route(`${app.origin}/about`, async (route) => {
        const response = await route.fetch();
        const headers = { ...response.headers() };
        delete headers["x-frame-options"];
        headers["content-security-policy"] = (
          headers["content-security-policy"] ?? ""
        ).replace(/;?\s*frame-ancestors[^;]*/i, "");
        await route.fulfill({ response, headers });
      });
      const unprotected = await show(control);
      await control.close();
      expect(
        appFiles(unprotected).length,
        "without the headers the page is shown and loads its files",
      ).toBeGreaterThan(0);

      // The real thing.
      const protectedRun = await show(context);
      expect(protectedRun, "the browser asked for the page").toContain(
        `${app.origin}/about`,
      );
      expect(appFiles(protectedRun), "a refused frame loads nothing").toEqual(
        [],
      );
    } finally {
      framer.close();
    }
  },
);
