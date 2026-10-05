// Synthetic local product benchmark. It records no document-derived data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const scratch = path.join(root, ".tools/page-tools-review");
const resultPath = path.join(
  root,
  "docs/benchmarks/M3A2-page-tools-results.json",
);
await mkdir(scratch, { recursive: true });

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument } = pdfRequire("pdf-lib");
const source = await PDFDocument.load(
  await readFile(path.join(root, "tests/fixtures/pdf/preview-features.pdf")),
);
const document = await PDFDocument.create();
for (const page of await document.copyPages(
  source,
  Array.from({ length: 200 }, (_, index) => index % 4),
))
  document.addPage(page);
const fixture = path.join(scratch, "page-tools-200.pdf");
await writeFile(fixture, await document.save());

const port = 3111;
const origin = `http://127.0.0.1:${port}`;
const nextBin = path.join(webRoot, "node_modules/next/dist/bin/next");
const server = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  { cwd: webRoot, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Next exited before readiness: ${serverLog}`);
    try {
      if ((await fetch(`${origin}/extract-pdf-pages`)).ok) return;
    } catch {
      // Readiness polling only.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Next did not become ready: ${serverLog}`);
}

async function stableContexts(page) {
  let previous = -1;
  let stableSamples = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await page.evaluate(() => window.pageToolBench.contexts);
    stableSamples = current === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 8) return current;
    previous = current;
    await page.waitForTimeout(100);
  }
  throw new Error("Canvas rendering did not settle.");
}

async function eventually(check) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Benchmark condition timed out.");
}

const browser = await chromium.launch();
const rows = [];
try {
  await waitForServer();
  for (const viewport of [
    { label: "desktop", width: 1280, height: 900, dpr: 1, mobile: false },
    { label: "mobile", width: 390, height: 844, dpr: 3, mobile: true },
  ]) {
    for (const route of [
      "/extract-pdf-pages",
      "/delete-pdf-pages",
      "/rotate-pdf",
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.dpr,
        isMobile: viewport.mobile,
        acceptDownloads: true,
      });
      await context.addInitScript(() => {
        window.pageToolBench = { contexts: 0, byPage: {} };
        const native = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (...args) {
          window.pageToolBench.contexts++;
          const id = this.parentElement?.dataset.pageId;
          if (id)
            window.pageToolBench.byPage[id] =
              (window.pageToolBench.byPage[id] ?? 0) + 1;
          return Reflect.apply(native, this, args);
        };
      });
      const page = await context.newPage();
      const unexpected = [];
      context.on("request", (request) => {
        if (
          new URL(request.url()).origin !== origin ||
          request.method() !== "GET" ||
          request.postData()
        )
          unexpected.push("request");
      });
      page.on("pageerror", () => unexpected.push("pageerror"));
      const started = performance.now();
      await page.goto(`${origin}${route}`);
      await page.getByLabel("Choose PDF").setInputFiles(fixture);
      await eventually(
        async () => (await page.locator("li[data-page-id]").count()) === 200,
      );
      await page.locator("li[data-page-id]").first().scrollIntoViewIfNeeded();
      await eventually(
        async () =>
          (await page
            .locator("li[data-page-id]")
            .first()
            .locator("canvas")
            .evaluate((canvas) => canvas.width * canvas.height)) > 0,
      );
      const readyMs = performance.now() - started;
      await stableContexts(page);
      const before = await page.evaluate(() => ({
        ...window.pageToolBench.byPage,
      }));
      const selectStarted = performance.now();
      await page.getByRole("button", { name: "Select all pages" }).click();
      await page.getByRole("button", { name: "Clear selection" }).click();
      const selectAllClearMs = performance.now() - selectStarted;
      await stableContexts(page);
      const afterSelection = await page.evaluate(() => ({
        ...window.pageToolBench.byPage,
      }));
      const selectionRerenders = addedRenders(before, afterSelection);
      assert.equal(
        selectionRerenders,
        0,
        `${route} selection must not rerender preview canvases`,
      );

      let affectedRerenders = 0;
      let unaffectedRerenders = 0;
      if (route === "/rotate-pdf") {
        const first = page.locator("li[data-page-id]").first();
        const firstId = await first.getAttribute("data-page-id");
        await first.getByRole("checkbox").check();
        const beforeRotate = await page.evaluate(() => ({
          ...window.pageToolBench.byPage,
        }));
        await page
          .getByRole("button", { name: "Rotate selected right" })
          .click();
        await eventually(
          async () =>
            (await page.evaluate(
              (id) => window.pageToolBench.byPage[id] ?? 0,
              firstId,
            )) > (beforeRotate[firstId] ?? 0),
        );
        await stableContexts(page);
        const afterRotate = await page.evaluate(() => ({
          ...window.pageToolBench.byPage,
        }));
        affectedRerenders = Math.max(
          0,
          (afterRotate[firstId] ?? 0) - (beforeRotate[firstId] ?? 0),
        );
        unaffectedRerenders = Object.entries(beforeRotate)
          .filter(([id]) => id !== firstId)
          .reduce(
            (sum, [id, count]) =>
              sum + Math.max(0, (afterRotate[id] ?? 0) - count),
            0,
          );
        assert.ok(affectedRerenders > 0);
        assert.equal(unaffectedRerenders, 0);
      }

      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        true,
      );
      assert.deepEqual(unexpected, []);
      await page.screenshot({
        path: path.join(scratch, `${viewport.label}-${route.slice(1)}.png`),
        fullPage: false,
      });

      if (viewport.label === "desktop") {
        await saveRepresentativeOutput(page, route);
      }
      await page.getByRole("button", { name: "Start over" }).click();
      await eventually(
        async () => (await page.locator("canvas").count()) === 0,
      );
      rows.push({
        viewport: viewport.label,
        route,
        pages: 200,
        readyMs: Math.round(readyMs),
        selectAllClearMs: Math.round(selectAllClearMs),
        previouslyRenderedThumbnailRendersDuringSelection: selectionRerenders,
        affectedThumbnailRendersDuringRotation: affectedRerenders,
        unaffectedThumbnailRendersDuringRotation: unaffectedRerenders,
        horizontalOverflow: false,
      });
      await context.close();
    }
  }
  await writeFile(
    resultPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        browser: "project-pinned Playwright Chromium",
        workload:
          "Synthetic 200-page mixed-geometry PDF; Select all/Clear selection on each route; selected-page rotation where applicable",
        schedulerInvariant:
          "ThumbnailScheduler unit coverage fixes concurrency at 1 and retained queue at 8.",
        rows,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  server.kill();
}

function addedRenders(before, after) {
  return Object.entries(before).reduce(
    (sum, [id, count]) => sum + Math.max(0, (after[id] ?? 0) - count),
    0,
  );
}

async function saveRepresentativeOutput(page, route) {
  if (route === "/extract-pdf-pages") {
    await page.getByLabel("Select source page 2 for extraction").check();
    await page.getByLabel("Select source page 4 for extraction").check();
    await page.getByRole("button", { name: "Export selected pages" }).click();
  } else if (route === "/delete-pdf-pages") {
    await page.getByLabel("Mark source page 2 for removal").check();
    await page.getByLabel("Mark source page 4 for removal").check();
    await page.getByRole("button", { name: "Export remaining pages" }).click();
  } else {
    // Page 1 remains selected and already has a +90° requested rotation.
    await page.getByRole("button", { name: "Export rotated PDF" }).click();
  }
  const link = page.locator("a[download]");
  await link.waitFor();
  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  await download.saveAs(
    path.join(scratch, `representative-${download.suggestedFilename()}`),
  );
}
