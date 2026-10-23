import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { Page, Response } from "@playwright/test";
import { expect, test } from "./fixtures";

// M7F (ADR-037): performance budgets. A budget is a number that fails the build
// when it is passed, so a slow page cannot arrive by accident. Everything here
// is measured on the production build, and only what can be measured the same
// way twice is enforced: bytes (gzip, level 9), what loads when, the cache
// headers, layout shift, and the very loose ceilings on time. The finer timing
// numbers are measured by benchmarks/run-performance.mjs and recorded in
// docs/benchmarks/M7F-performance.md, not asserted.
//
// The limits below were set from those measurements, with headroom over the
// largest measured value. Raising one is a decision to write down in an ADR.

test.describe.configure({ timeout: 300_000 });

const BUDGET = {
  /** Every page, on first load, before anyone does anything. */
  load: {
    scriptKB: 180,
    styleKB: 10,
    documentKB: 15,
    totalKB: 230,
    requests: 35,
  },
  /** Extra script a page may fetch when the first file is chosen. */
  firstUseKB: { engine: 560, pdfLibOnly: 220 },
  /** Cumulative layout shift. Google's "good" is 0.1; a still page is 0. */
  cls: { load: 0.02, firstFile: 0.1 },
  /** Largest Contentful Paint, on a slow phone. Google's "good" is 2500 ms. */
  lcpMs: 2500,
  /** The slowest interaction on a 50-page document. Google's "poor" is 500. */
  interactionMs: 500,
};

// The pages the build made, so a new page is covered without anyone adding it.
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../.next/csp-manifest.json", import.meta.url)),
    "utf8",
  ),
) as { routes: Record<string, unknown> | string[] };
const ROUTES = Array.isArray(manifest.routes)
  ? manifest.routes
  : Object.keys(manifest.routes);

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
    ),
  );
const FOUR_PAGES = fixture("preview-features.pdf");

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
async function blankPages(count: number): Promise<Buffer> {
  const { PDFDocument } = pdfRequire("pdf-lib");
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index++) document.addPage([612, 792]);
  return Buffer.from(await document.save());
}

// Text that only the PDF libraries contain: error names from PDF.js and from
// pdf-lib. If a page's first load carries either, an engine is not lazy.
const ENGINE = /InvalidPDFException|Failed to parse PDF document/;

const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;

interface Weight {
  script: number;
  style: number;
  document: number;
  total: number;
  requests: number;
  /** Script files that contain a PDF engine. */
  engine: string[];
}

/** Everything the page fetches while `act` runs, by kind, gzip level 9. */
async function weigh(page: Page, act: () => Promise<void>): Promise<Weight> {
  const weight: Weight = {
    script: 0,
    style: 0,
    document: 0,
    total: 0,
    requests: 0,
    engine: [],
  };
  const pending: Promise<void>[] = [];
  const listener = (response: Response) => {
    pending.push(
      (async () => {
        try {
          const body = await response.body();
          const kind = response.request().resourceType();
          const path = new URL(response.url()).pathname;
          const gzip = gzipSync(body, { level: 9 }).length;
          weight.requests++;
          weight.total += gzip;
          // A Web Worker's own script is reported as "other", not "script",
          // and PDF.js's worker is most of the engine: go by the file.
          if (kind === "script" || /\.m?js$/.test(path)) {
            weight.script += gzip;
            if (ENGINE.test(body.toString("latin1"))) weight.engine.push(path);
          } else if (kind === "stylesheet") weight.style += gzip;
          else if (kind === "document") weight.document += gzip;
        } catch {
          // A redirect or an aborted prefetch has no body to weigh.
        }
      })(),
    );
  };
  page.on("response", listener);
  await act();
  await Promise.all(pending);
  page.off("response", listener);
  return weight;
}

const measured = (value: unknown) =>
  test
    .info()
    .annotations.push({ type: "measured", description: JSON.stringify(value) });

// ── 1. Weight, and what loads when ──────────────────────────────────────

test("every page is inside its load budget and carries no PDF engine", async ({
  page,
}) => {
  const rows: Record<string, unknown>[] = [];
  for (const route of ROUTES) {
    await test.step(route, async () => {
      const weight = await weigh(page, async () => {
        await page.goto(route, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
      });
      rows.push({
        route,
        scriptKB: kb(weight.script),
        styleKB: kb(weight.style),
        documentKB: kb(weight.document),
        totalKB: kb(weight.total),
        requests: weight.requests,
      });
      const over: string[] = [];
      const limit = BUDGET.load;
      if (kb(weight.script) > limit.scriptKB)
        over.push(`script ${kb(weight.script)} KB is over ${limit.scriptKB}`);
      if (kb(weight.style) > limit.styleKB)
        over.push(`style ${kb(weight.style)} KB is over ${limit.styleKB}`);
      if (kb(weight.document) > limit.documentKB)
        over.push(`HTML ${kb(weight.document)} KB is over ${limit.documentKB}`);
      if (kb(weight.total) > limit.totalKB)
        over.push(`total ${kb(weight.total)} KB is over ${limit.totalKB}`);
      if (weight.requests > limit.requests)
        over.push(`${weight.requests} requests is over ${limit.requests}`);
      if (weight.engine.length)
        over.push(
          `a PDF engine loads before any file is chosen: ${weight.engine.join(", ")}`,
        );
      expect.soft(over, `${route} (gzip)`).toEqual([]);
    });
  }
  measured(rows);
});

test("a PDF engine is fetched when a file is chosen, and within its budget", async ({
  page,
}) => {
  const rows: Record<string, unknown>[] = [];
  const tools: [string, number][] = [
    ["/split-pdf", BUDGET.firstUseKB.engine],
    ["/organize-pdf", BUDGET.firstUseKB.engine],
    ["/pdf-to-jpg", BUDGET.firstUseKB.engine],
    ["/pdf-to-text", BUDGET.firstUseKB.engine],
    ["/remove-pdf-metadata", BUDGET.firstUseKB.pdfLibOnly],
  ];
  for (const [route, limit] of tools) {
    await test.step(route, async () => {
      const first = await weigh(page, () =>
        page.goto(route, { waitUntil: "networkidle" }).then(() => undefined),
      );
      expect.soft(first.engine, `${route} first load`).toEqual([]);
      const use = await weigh(page, async () => {
        await page.locator('input[type="file"]').first().setInputFiles({
          name: "four-pages.pdf",
          mimeType: "application/pdf",
          buffer: FOUR_PAGES,
        });
        await page.waitForTimeout(3000);
      });
      rows.push({ route, scriptKB: kb(use.script), limit });
      // The positive control: the check above can only mean something if it
      // can see an engine when there is one.
      expect
        .soft(use.engine.length, `${route}: the engine is fetched on first use`)
        .toBeGreaterThan(0);
      expect
        .soft(kb(use.script), `${route}: script fetched on first use (gzip)`)
        .toBeLessThanOrEqual(limit);
    });
  }
  measured(rows);
});

// ── 2. Caching ──────────────────────────────────────────────────────────

test("files that never change are cached for a year, and pages can be cached", async ({
  page,
  request,
}) => {
  const urls: string[] = [];
  const response = await page.goto("/", { waitUntil: "networkidle" });
  const html = response?.headers()["cache-control"] ?? "";
  // A page may be kept by a CDN or by the browser; it must not forbid it.
  expect(html, "the page's Cache-Control").toMatch(/(s-maxage|max-age)=[1-9]/);
  expect(html, "the page's Cache-Control").not.toMatch(
    /no-store|no-cache|private/,
  );

  const chunk = await page.evaluate(
    () =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => /\/_next\/static\/.+\.js$/.test(name)) ?? "",
  );
  expect(chunk, "a built script file").not.toBe("");
  urls.push(chunk);

  // PDF.js's folders are named for their version, so nothing in them changes.
  const root = fileURLToPath(
    new URL("../public/vendor/pdfjs/", import.meta.url),
  );
  const version = readdirSync(root).find((name) => /^\d/.test(name));
  expect(version, "a vendored PDF.js version folder").toBeTruthy();
  for (const path of [
    "manifest.json",
    `cmaps/${readdirSync(`${root}${version}/cmaps`)[0]}`,
    `standard_fonts/${readdirSync(`${root}${version}/standard_fonts`)[0]}`,
    `wasm/${readdirSync(`${root}${version}/wasm`).find((n) => n.endsWith(".wasm"))}`,
  ])
    urls.push(`/vendor/pdfjs/${version}/${path}`);

  for (const url of urls) {
    const got = await request.get(url);
    expect(got.status(), url).toBe(200);
    const control = got.headers()["cache-control"] ?? "";
    expect(control, `${url} Cache-Control`).toMatch(/max-age=31536000/);
    expect(control, `${url} Cache-Control`).toMatch(/immutable/);
  }
});

// ── 3. What a visitor feels (Chromium only: these are its measurements) ──

const SLOW_PHONE = {
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

async function slowPhone(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    ...SLOW_PHONE,
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

// Runs in the page, before it starts, so it must not use anything outside it.
const observe = () => {
  const store = {
    lcp: 0,
    cls: 0,
    events: [] as number[],
  };
  (window as unknown as { __perf: typeof store }).__perf = store;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) store.lcp = entry.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const shift = entry as PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      };
      if (!shift.hadRecentInput) store.cls += shift.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const timing = entry as PerformanceEntry & { interactionId?: number };
      if (timing.interactionId) store.events.push(Math.round(entry.duration));
    }
  }).observe({
    type: "event",
    durationThreshold: 16,
    buffered: true,
  } as PerformanceObserverInit);
};

const readings = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __perf: { lcp: number; cls: number; events: number[] };
        }
      ).__perf,
  );

test.describe("what a visitor feels", () => {
  // Layout shift, largest paint and event timing are Chromium's measurements,
  // and the budgets are for a phone: what moves on a 412 px wide screen is
  // not what moves on a desktop one, where the long guide under a tool sits
  // below the fold and its shifts are not counted. One project measures it.
  test.skip(
    ({ browserName, isMobile }) => browserName !== "chromium" || !isMobile,
    "measured on phone-sized Chromium (Pixel 7) only",
  );

  test("every page paints soon and holds still, on a slow phone", async ({
    page,
  }) => {
    await page.addInitScript(observe);
    await slowPhone(page);
    const rows: Record<string, unknown>[] = [];
    for (const route of ROUTES) {
      await test.step(route, async () => {
        await page.goto(route, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
        const got = await readings(page);
        rows.push({
          route,
          lcpMs: Math.round(got.lcp),
          cls: Math.round(got.cls * 1000) / 1000,
        });
        expect
          .soft(got.lcp, `${route}: Largest Contentful Paint (ms)`)
          .toBeLessThanOrEqual(BUDGET.lcpMs);
        expect
          .soft(got.cls, `${route}: layout shift while loading`)
          .toBeLessThanOrEqual(BUDGET.cls.load);
      });
    }
    measured(rows);
  });

  test("choosing a file does not shove the page around", async ({ page }) => {
    await page.addInitScript(observe);
    const rows: Record<string, unknown>[] = [];
    const tools = [
      "/split-pdf",
      "/organize-pdf",
      "/pdf-to-jpg",
      "/extract-pdf-pages",
      "/delete-pdf-pages",
      "/rotate-pdf",
      "/pdf-to-text",
      "/remove-pdf-metadata",
      "/compress-pdf",
      "/merge-pdf",
    ];
    for (const route of tools) {
      await test.step(route, async () => {
        await page.goto(route, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);
        await page.evaluate(() => {
          (window as unknown as { __perf: { cls: number } }).__perf.cls = 0;
        });
        await page.locator('input[type="file"]').first().setInputFiles({
          name: "four-pages.pdf",
          mimeType: "application/pdf",
          buffer: FOUR_PAGES,
        });
        await page.waitForTimeout(3000);
        const got = await readings(page);
        rows.push({ route, cls: Math.round(got.cls * 1000) / 1000 });
        expect
          .soft(got.cls, `${route}: layout shift after choosing a file`)
          .toBeLessThanOrEqual(BUDGET.cls.firstFile);
      });
    }
    measured(rows);
  });

  test("a 50-page document answers a tap quickly, on a slow phone", async ({
    page,
  }) => {
    await page.addInitScript(observe);
    await page.goto("/organize-pdf", { waitUntil: "networkidle" });
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "fifty-pages.pdf",
        mimeType: "application/pdf",
        buffer: await blankPages(50),
      });
    await expect(page.locator("li[data-page-id]")).toHaveCount(50, {
      timeout: 60_000,
    });
    await page.waitForTimeout(2000);
    await slowPhone(page);
    await page.evaluate(() => {
      (window as unknown as { __perf: { events: number[] } }).__perf.events =
        [];
    });
    const later = page.getByRole("button", { name: /^Move later/ });
    await later.first().click();
    await later.nth(2).click();
    await page.waitForTimeout(1000);
    const { events } = await readings(page);
    measured({ interactions: events });
    expect(
      events.length,
      "the interactions were seen by the browser's event timing",
    ).toBeGreaterThan(0);
    expect(
      Math.max(...events),
      "the slowest interaction (ms)",
    ).toBeLessThanOrEqual(BUDGET.interactionMs);
  });
});
