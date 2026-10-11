// Synthetic local benchmark. It records no source filenames or document data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const scratch = path.join(root, ".tools/pdf-to-jpg-review");
const resultPath = path.join(
  root,
  "docs/benchmarks/M3B2-pdf-to-jpg-results.json",
);
await mkdir(scratch, { recursive: true });

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { unzipSync } = pdfRequire("fflate");
const { PDFDocument } = pdfRequire("pdf-lib");

const sourceFixture = await readFile(
  path.join(root, "tests/fixtures/pdf/preview-features.pdf"),
);
const boundaryDocument = await PDFDocument.create();
for (let page = 0; page < 50; page++) boundaryDocument.addPage([612, 792]);
const boundaryFixture = Buffer.from(await boundaryDocument.save());

const port = 3114;
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

async function eventually(check, attempts = 1200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Benchmark condition timed out.");
}

await eventually(async () => {
  if (server.exitCode !== null)
    throw new Error(`Next exited before readiness: ${serverLog}`);
  try {
    return (await fetch(`${origin}/pdf-to-jpg`)).ok;
  } catch {
    return false;
  }
});

function dimensions(bytes) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3)
      return {
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    offset += marker === 0xd8 || marker === 0xd9 ? 2 : 2 + length;
  }
  throw new Error("JPEG dimensions unavailable");
}

const browser = await chromium.launch();
const rows = [];
try {
  for (const scenario of [
    {
      name: "mixed-four-pages-150dpi",
      bytes: sourceFixture,
      dpi: 150,
      selected: null,
      expected: [
        { width: 1042, height: 1354 },
        { width: 1042, height: 1354 },
        { width: 1042, height: 1354 },
        { width: 1167, height: 875 },
      ],
    },
    {
      name: "rotated-page-300dpi",
      bytes: sourceFixture,
      dpi: 300,
      selected: 4,
      expected: [{ width: 2333, height: 1750 }],
    },
    {
      name: "maximum-count-96dpi",
      bytes: boundaryFixture,
      dpi: 96,
      selected: null,
      expected: Array.from({ length: 50 }, () => ({
        width: 816,
        height: 1056,
      })),
    },
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const live = new Set();
      const metrics = { liveUrls: 0, peakUrls: 0, workers: 0, peakWorkers: 0 };
      window.pdfJpegMetrics = metrics;
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        live.add(url);
        metrics.liveUrls = live.size;
        metrics.peakUrls = Math.max(metrics.peakUrls, live.size);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        live.delete(url);
        metrics.liveUrls = live.size;
        revoke(url);
      };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          metrics.workers++;
          metrics.peakWorkers = Math.max(metrics.peakWorkers, metrics.workers);
        }
        terminate() {
          metrics.workers--;
          super.terminate();
        }
      };
    });
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
    await page.goto(`${origin}/pdf-to-jpg`);
    const previewStarted = performance.now();
    await page.getByLabel("Choose PDF").setInputFiles({
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: scenario.bytes,
    });
    await page.locator("li[data-page-id]").last().waitFor({ timeout: 60_000 });
    const previewMs = performance.now() - previewStarted;
    if (scenario.selected) {
      await page.getByLabel("Selected pages").check();
      await page
        .getByLabel(`Select source page ${scenario.selected} for JPG export`)
        .check();
    }
    await page.getByLabel(`${scenario.dpi} DPI`).check();
    const generationStarted = performance.now();
    await page.getByRole("button", { name: "Create JPG images" }).click();
    const link = page.locator("[download]");
    await link.waitFor({ timeout: 120_000 });
    const generationMs = performance.now() - generationStarted;
    const pending = page.waitForEvent("download");
    await link.click();
    const download = await pending;
    const outputPath = path.join(
      scratch,
      `${scenario.name}-${download.suggestedFilename()}`,
    );
    await download.saveAs(outputPath);
    const output = new Uint8Array(await readFile(outputPath));
    const images = download.suggestedFilename().endsWith(".zip")
      ? Object.values(unzipSync(output))
      : [output];
    assert.equal(images.length, scenario.expected.length);
    assert.deepEqual(images.map(dimensions), scenario.expected);
    assert.equal(unexpected.length, 0);
    const beforeReset = await page.evaluate(() => window.pdfJpegMetrics);
    await page.getByRole("button", { name: "Start over" }).click();
    await eventually(async () => {
      const metrics = await page.evaluate(() => window.pdfJpegMetrics);
      return metrics.liveUrls === 0 && metrics.workers === 0;
    });
    rows.push({
      name: scenario.name,
      pages: images.length,
      dpi: scenario.dpi,
      previewMs: Math.round(previewMs),
      generationMs: Math.round(generationMs),
      outputBytes: output.byteLength,
      combinedJpegBytes: images.reduce(
        (sum, image) => sum + image.byteLength,
        0,
      ),
      peakWorkers: beforeReset.peakWorkers,
      peakLiveUrls: beforeReset.peakUrls,
      unexpectedRequestsOrErrors: unexpected.length,
    });
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}

await writeFile(
  resultPath,
  `${JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2)}\n`,
);
console.log(JSON.stringify(rows, null, 2));
