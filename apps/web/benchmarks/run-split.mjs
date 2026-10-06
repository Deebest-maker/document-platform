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
const scratch = path.join(root, ".tools/split-review");
const resultPath = path.join(root, "docs/benchmarks/M3A3-split-results.json");
await mkdir(scratch, { recursive: true });

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument } = pdfRequire("pdf-lib");
const { unzipSync } = pdfRequire("fflate");
const source = await PDFDocument.load(
  await readFile(path.join(root, "tests/fixtures/pdf/preview-features.pdf")),
);
const document = await PDFDocument.create();
for (const page of await document.copyPages(
  source,
  Array.from({ length: 200 }, (_, index) => index % 4),
))
  document.addPage(page);
const fixture = path.join(scratch, "split-200.pdf");
await writeFile(fixture, await document.save());

const port = 3112;
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

async function eventually(check, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Benchmark condition timed out.");
}

async function waitForServer() {
  await eventually(async () => {
    if (server.exitCode !== null)
      throw new Error(`Next exited before readiness: ${serverLog}`);
    try {
      return (await fetch(`${origin}/split-pdf`)).ok;
    } catch {
      return false;
    }
  });
}

const browser = await chromium.launch();
const rows = [];
try {
  await waitForServer();
  for (const viewport of [
    { label: "desktop", width: 1280, height: 900, dpr: 1, mobile: false },
    { label: "mobile", width: 390, height: 844, dpr: 3, mobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.dpr,
      isMobile: viewport.mobile,
      acceptDownloads: true,
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
    await page.goto(`${origin}/split-pdf`);
    const loadStarted = performance.now();
    await page.getByLabel("Choose PDF").setInputFiles(fixture);
    await eventually(
      async () => (await page.locator("li[data-page-id]").count()) === 200,
    );
    const readyMs = performance.now() - loadStarted;
    for (let index = 1; index < 20; index++)
      await page.getByRole("button", { name: "Add output group" }).click();
    for (let index = 0; index < 20; index++) {
      const start = index * 10 + 1;
      await page
        .getByLabel(`Output ${index + 1} page ranges`)
        .fill(`${start}-${start + 9}`);
    }
    const heapBefore = await page.evaluate(
      () => performance.memory?.usedJSHeapSize ?? null,
    );
    const generateStarted = performance.now();
    await page.getByRole("button", { name: "Generate split files" }).click();
    const link = page.getByRole("link", { name: "Download split ZIP" });
    await link.waitFor({ timeout: 60_000 });
    const generateMs = performance.now() - generateStarted;
    const heapWithResult = await page.evaluate(
      () => performance.memory?.usedJSHeapSize ?? null,
    );
    const pending = page.waitForEvent("download");
    await link.click();
    const download = await pending;
    const outputPath = path.join(scratch, `${viewport.label}-split.zip`);
    await download.saveAs(outputPath);
    const archive = new Uint8Array(await readFile(outputPath));
    const entries = unzipSync(archive);
    assert.deepEqual(
      Object.keys(entries),
      Array.from(
        { length: 20 },
        (_, index) => `split-${String(index + 1).padStart(2, "0")}.pdf`,
      ),
    );
    const combinedPdfBytes = Object.values(entries).reduce(
      (sum, bytes) => sum + bytes.byteLength,
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      true,
    );
    assert.deepEqual(unexpected, []);
    await page.screenshot({
      path: path.join(scratch, `${viewport.label}-split.png`),
      fullPage: false,
    });
    await page.getByRole("button", { name: "Start over" }).click();
    await eventually(async () => (await page.locator("canvas").count()) === 0);
    if (viewport.label === "desktop") {
      await page.getByLabel("Choose PDF").setInputFiles(fixture);
      await eventually(
        async () => (await page.locator("li[data-page-id]").count()) === 200,
      );
      await page.getByLabel("Output 1 page ranges").fill("2,4");
      await page.getByRole("button", { name: "Generate split files" }).click();
      const direct = page.getByRole("link", { name: "Download split PDF" });
      await direct.waitFor();
      const directPending = page.waitForEvent("download");
      await direct.click();
      const directDownload = await directPending;
      assert.equal(directDownload.suggestedFilename(), "split-01.pdf");
      await directDownload.saveAs(
        path.join(scratch, "representative-split-01.pdf"),
      );
      await page.getByRole("button", { name: "Start over" }).click();
    }
    rows.push({
      viewport: viewport.label,
      inputPages: 200,
      outputFiles: 20,
      pagesPerOutput: 10,
      readyMs: Math.round(readyMs),
      generateAndArchiveMs: Math.round(generateMs),
      combinedPdfBytes,
      archiveBytes: archive.byteLength,
      observedHeapDeltaBytes:
        heapBefore === null || heapWithResult === null
          ? null
          : heapWithResult - heapBefore,
      horizontalOverflow: false,
    });
    await context.close();
  }
  await writeFile(
    resultPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        browser: "project-pinned Playwright Chromium",
        workload:
          "Synthetic 200-page mixed-geometry PDF; 20 outputs of 10 pages; stored ZIP",
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
