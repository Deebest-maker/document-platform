// Synthetic product benchmark (M7F, ADR-037). It measures the production build
// the way the performance budgets in e2e/performance-budgets.spec.ts do, and
// also records the timings that are too noisy to assert: long tasks and
// blocking time while the page loads, and the slowest tap on a large document.
// It uses only blank generated pages and records no document-derived data.
//
//   pnpm --filter @document-platform/web build
//   node apps/web/benchmarks/run-performance.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const resultPath = path.join(
  root,
  "docs/benchmarks/M7F-performance-results.json",
);

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument } = pdfRequire("pdf-lib");
async function blankPages(count) {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index++) document.addPage([612, 792]);
  return Buffer.from(await document.save());
}
const fourPages = await readFile(
  path.join(root, "tests/fixtures/pdf/preview-features.pdf"),
);

const manifest = JSON.parse(
  await readFile(path.join(webRoot, ".next/csp-manifest.json"), "utf8"),
);
const routes = Array.isArray(manifest.routes)
  ? manifest.routes
  : Object.keys(manifest.routes);

const port = 3111;
const origin = `http://127.0.0.1:${port}`;
const nextBin = path.join(webRoot, "node_modules/next/dist/bin/next");
const server = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  { cwd: webRoot, stdio: ["ignore", "pipe", "pipe"] },
);
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    if ((await fetch(origin)).ok) break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const ENGINE = /InvalidPDFException|Failed to parse PDF document/;
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
const browser = await chromium.launch();

const observers = () => {
  const store = { lcp: 0, cls: 0, longTasks: [], events: [] };
  window.__perf = store;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) store.lcp = entry.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (!entry.hadRecentInput) store.cls += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      store.longTasks.push(Math.round(entry.duration));
  }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (entry.interactionId) store.events.push(Math.round(entry.duration));
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
};

async function newPage({ slow }) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  if (slow) {
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await page.addInitScript(observers);
  return { context, page };
}

function weigher(page) {
  const weight = {
    script: 0,
    style: 0,
    document: 0,
    total: 0,
    requests: 0,
    engine: 0,
  };
  const pending = [];
  page.on("response", (response) => {
    pending.push(
      (async () => {
        try {
          const body = await response.body();
          const kind = response.request().resourceType();
          const gzip = gzipSync(body, { level: 9 }).length;
          weight.requests++;
          weight.total += gzip;
          // A Web Worker's own script is reported as "other", not "script".
          if (
            kind === "script" ||
            /\.m?js$/.test(new URL(response.url()).pathname)
          ) {
            weight.script += gzip;
            if (ENGINE.test(body.toString("latin1"))) weight.engine++;
          } else if (kind === "stylesheet") weight.style += gzip;
          else if (kind === "document") weight.document += gzip;
        } catch {
          // no body (redirect, aborted prefetch)
        }
      })(),
    );
  });
  return async () => {
    await Promise.all(pending);
    pending.length = 0;
    const out = {
      scriptKB: kb(weight.script),
      styleKB: kb(weight.style),
      documentKB: kb(weight.document),
      totalKB: kb(weight.total),
      requests: weight.requests,
      engineFiles: weight.engine,
    };
    for (const key of Object.keys(weight)) weight[key] = 0;
    return out;
  };
}

const perf = (page) => page.evaluate(() => ({ ...window.__perf }));
const blocking = (tasks) =>
  tasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0);

const results = {
  generated: new Date().toISOString().slice(0, 10),
  pages: [],
  firstUse: [],
  chooseFile: [],
  interaction: null,
};

try {
  // 1. Weight, paint, shift and blocking, per page, on a slow phone.
  for (const route of routes) {
    const { context, page } = await newPage({ slow: true });
    const take = weigher(page);
    await page.goto(origin + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const got = await perf(page);
    results.pages.push({
      route,
      ...(await take()),
      lcpMs: Math.round(got.lcp),
      cls: Math.round(got.cls * 1000) / 1000,
      longTasks: got.longTasks.length,
      longestTaskMs: Math.max(0, ...got.longTasks),
      blockingMs: blocking(got.longTasks),
    });
    await context.close();
  }

  // 2. What the first file costs, and how the page behaves when it arrives.
  for (const route of [
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
  ]) {
    const { context, page } = await newPage({ slow: true });
    const take = weigher(page);
    await page.goto(origin + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await take();
    await page.evaluate(() => {
      window.__perf.cls = 0;
      window.__perf.longTasks = [];
    });
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "four-pages.pdf",
      mimeType: "application/pdf",
      buffer: fourPages,
    });
    await page.waitForTimeout(6000);
    const got = await perf(page);
    const weight = await take();
    results.chooseFile.push({
      route,
      scriptKB: weight.scriptKB,
      engineFiles: weight.engineFiles,
      cls: Math.round(got.cls * 1000) / 1000,
      longTasks: got.longTasks.length,
      longestTaskMs: Math.max(0, ...got.longTasks),
    });
    await context.close();
  }

  // 3. The slowest tap on a 50-page document, on a slow phone.
  {
    const { context, page } = await newPage({ slow: false });
    await page.goto(origin + "/organize-pdf", { waitUntil: "networkidle" });
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "fifty-pages.pdf",
        mimeType: "application/pdf",
        buffer: await blankPages(50),
      });
    await page.locator("li[data-page-id]").nth(49).waitFor({ timeout: 60000 });
    await page.waitForTimeout(2000);
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.evaluate(() => (window.__perf.events = []));
    const later = page.getByRole("button", { name: /^Move later/ });
    await later.first().click();
    await later.nth(2).click();
    await page.waitForTimeout(1000);
    const got = await perf(page);
    results.interaction = {
      route: "/organize-pdf",
      pages: 50,
      cpuThrottle: 4,
      interactionsMs: got.events,
    };
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}

await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
const max = (rows, key) => Math.max(...rows.map((row) => row[key]));
console.log(
  `pages ${results.pages.length}: max script ${max(results.pages, "scriptKB")} KB, total ${max(results.pages, "totalKB")} KB, LCP ${max(results.pages, "lcpMs")} ms, CLS ${max(results.pages, "cls")}, blocking ${max(results.pages, "blockingMs")} ms`,
);
console.log(
  `first file: script ${max(results.chooseFile, "scriptKB")} KB, CLS ${max(results.chooseFile, "cls")}`,
);
console.log(
  `50-page taps: ${JSON.stringify(results.interaction.interactionsMs)} ms`,
);
console.log(`written ${path.relative(root, resultPath)}`);
