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
const scratch = path.join(root, ".tools/organize-benchmark");
const resultPath = path.join(
  root,
  "docs/benchmarks/M3A1-organize-results.json",
);
await mkdir(scratch, { recursive: true });

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument } = pdfRequire("pdf-lib");
const source = await PDFDocument.load(
  await readFile(path.join(root, "tests/fixtures/pdf/preview-features.pdf")),
);
const fixtures = [];
for (const count of [10, 50, 100, 200]) {
  const output = await PDFDocument.create();
  for (const page of await output.copyPages(
    source,
    Array.from({ length: count }, (_, index) => index % 4),
  ))
    output.addPage(page);
  const filename = path.join(scratch, `organize-${count}.pdf`);
  await writeFile(filename, await output.save());
  fixtures.push({ count, filename });
}

const port = 3110;
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
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Next exited before readiness: ${serverLog}`);
    try {
      if ((await fetch(`${origin}/organize-pdf`)).ok) return;
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
  for (let attempt = 0; attempt < 80; attempt++) {
    const current = await page.evaluate(() => window.organizeBench.contexts);
    stableSamples = current === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 10) return current;
    previous = current;
    await page.waitForTimeout(100);
  }
  throw new Error("Canvas rendering did not settle.");
}

const browser = await chromium.launch();
const rows = [];
try {
  await waitForServer();
  for (const viewport of [
    { label: "desktop", width: 1280, height: 900, dpr: 1, mobile: false },
    { label: "mobile", width: 390, height: 844, dpr: 3, mobile: true },
  ]) {
    for (const fixture of fixtures) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.dpr,
        isMobile: viewport.mobile,
      });
      await context.addInitScript(() => {
        window.organizeBench = { contexts: 0, byPage: {} };
        const native = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (...args) {
          window.organizeBench.contexts++;
          const id = this.parentElement?.dataset.pageId;
          if (id)
            window.organizeBench.byPage[id] =
              (window.organizeBench.byPage[id] ?? 0) + 1;
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
      await page.goto(`${origin}/organize-pdf`);
      await page.getByLabel("Choose PDF").setInputFiles(fixture.filename);
      await page.locator("li[data-page-id]").first().waitFor();
      await assertEventually(
        async () =>
          (await page.locator("li[data-page-id]").count()) === fixture.count,
      );
      await assertEventually(
        async () =>
          (await page
            .locator("li[data-page-id]")
            .first()
            .locator("canvas")
            .evaluate((canvas) => canvas.width * canvas.height)) > 0,
      );
      const readyMs = performance.now() - started;
      await stableContexts(page);
      const rendersBefore = await page.evaluate(() => ({
        ...window.organizeBench.byPage,
      }));
      const reorderStarted = performance.now();
      for (let iteration = 0; iteration < 12; iteration++) {
        await page
          .getByRole("button", { name: "Move page 1 later", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Move page 1 earlier", exact: true })
          .click();
      }
      const reorderMs = performance.now() - reorderStarted;
      await stableContexts(page);
      const rendersAfter = await page.evaluate(() => ({
        ...window.organizeBench.byPage,
      }));
      const rerenders = Object.entries(rendersBefore).reduce(
        (sum, [id, count]) =>
          sum + Math.max(0, (rendersAfter[id] ?? 0) - count),
        0,
      );
      assert.equal(
        rerenders,
        0,
        "Stable page IDs must not rerender thumbnails.",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        true,
      );
      assert.deepEqual(unexpected, []);
      if (fixture.count === 10) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
        });
        await page.screenshot({
          path: path.join(scratch, `${viewport.label}-top.png`),
        });
        await page.locator("li[data-page-id]").first().scrollIntoViewIfNeeded();
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
        });
        await page.screenshot({
          path: path.join(scratch, `${viewport.label}-grid.png`),
        });
      }
      if (fixture.count === 10 && viewport.label === "desktop") {
        await page
          .getByRole("button", { name: "Move page 1 later", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Export organized PDF", exact: true })
          .click();
        const link = page.getByRole("link", {
          name: "Download organized PDF",
        });
        await link.waitFor();
        const pending = page.waitForEvent("download");
        await link.click();
        const download = await pending;
        await download.saveAs(path.join(scratch, "organized-reference.pdf"));
      }
      await page.getByRole("button", { name: "Start over" }).click();
      await assertEventually(
        async () => (await page.locator("canvas").count()) === 0,
      );
      rows.push({
        viewport: viewport.label,
        pages: fixture.count,
        readyMs: Math.round(readyMs),
        reorderMoves: 24,
        reorderMs: Math.round(reorderMs),
        previouslyRenderedThumbnailRendersDuringReorder: rerenders,
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
          "Synthetic mixed-geometry PDF; 12 later/earlier cycles on source page 1",
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

async function assertEventually(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Benchmark condition timed out.");
}
