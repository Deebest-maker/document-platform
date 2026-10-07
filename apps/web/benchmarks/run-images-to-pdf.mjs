// Synthetic local product benchmark. It records no document-derived data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const scratch = path.join(root, ".tools/images-to-pdf-review");
const resultPath = path.join(
  root,
  "docs/benchmarks/M3B1-images-to-pdf-results.json",
);
await mkdir(scratch, { recursive: true });

const port = 3113;
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

async function eventually(check, attempts = 600) {
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
    return (await fetch(`${origin}/jpg-to-pdf`)).ok;
  } catch {
    return false;
  }
});

const browser = await chromium.launch();
const rows = [];
try {
  for (const scenario of [
    {
      name: "typical-phone-set",
      viewport: { width: 1280, height: 900 },
      images: Array.from({ length: 6 }, (_, index) => ({
        width: index % 2 ? 3024 : 4032,
        height: index % 2 ? 4032 : 3024,
        type: "image/jpeg",
      })),
    },
    {
      name: "mixed-jpeg-png",
      viewport: { width: 390, height: 844 },
      images: [
        { width: 2400, height: 3200, type: "image/png" },
        { width: 3200, height: 1800, type: "image/jpeg" },
        { width: 1800, height: 3200, type: "image/jpeg" },
        { width: 2048, height: 2048, type: "image/png" },
      ],
    },
    {
      name: "single-24mp-boundary",
      viewport: { width: 1280, height: 900 },
      images: [{ width: 6000, height: 4000, type: "image/jpeg" }],
    },
    {
      name: "exif-orientation-6",
      viewport: { width: 1280, height: 900 },
      images: [
        {
          width: 1200,
          height: 2000,
          type: "image/jpeg",
          orientation: 6,
        },
      ],
    },
    {
      name: "maximum-count",
      viewport: { width: 1280, height: 900 },
      images: Array.from({ length: 20 }, () => ({
        width: 1200,
        height: 900,
        type: "image/jpeg",
      })),
    },
  ]) {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const live = new Set();
      const metrics = { liveUrls: 0, peakUrls: 0, workers: 0 };
      window.imageBenchmarkMetrics = metrics;
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
    await page.goto(`${origin}/jpg-to-pdf`);
    const started = performance.now();
    await page.evaluate(async (images) => {
      const transfer = new DataTransfer();
      for (const [index, image] of images.entries()) {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (image.type === "image/png") {
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = `hsl(${(index * 47) % 360} 62% 46%)`;
          context.fillRect(
            canvas.width / 4,
            canvas.height / 4,
            canvas.width / 2,
            canvas.height / 2,
          );
        } else {
          context.fillStyle = `hsl(${(index * 47) % 360} 62% 46%)`;
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "white";
          context.fillRect(0, 0, canvas.width / 3, canvas.height / 3);
        }
        const blob = await new Promise((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("fixture"))),
            image.type,
            0.86,
          ),
        );
        let fileBlob = blob;
        if (image.orientation) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const app1 = Uint8Array.from([
            0xff,
            0xe1,
            0x00,
            0x22,
            0x45,
            0x78,
            0x69,
            0x66,
            0x00,
            0x00,
            0x4d,
            0x4d,
            0x00,
            0x2a,
            0x00,
            0x00,
            0x00,
            0x08,
            0x00,
            0x01,
            0x01,
            0x12,
            0x00,
            0x03,
            0x00,
            0x00,
            0x00,
            0x01,
            0x00,
            image.orientation,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
          ]);
          fileBlob = new Blob([bytes.slice(0, 2), app1, bytes.slice(2)], {
            type: image.type,
          });
        }
        const extension = image.type === "image/png" ? "png" : "jpg";
        transfer.items.add(
          new File([fileBlob], `synthetic-${index + 1}.${extension}`, {
            type: image.type,
          }),
        );
      }
      const input = document.querySelector('input[type="file"]');
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, scenario.images);
    await eventually(
      async () =>
        (await page.locator(".image-card img").count()) ===
        scenario.images.length,
    );
    const previewMs = performance.now() - started;
    await page.screenshot({
      path: path.join(scratch, `${scenario.name}-selected.png`),
      fullPage: false,
    });
    const heapBefore = await page.evaluate(
      () => performance.memory?.usedJSHeapSize ?? null,
    );
    let cancellationMs = null;
    if (scenario.name === "maximum-count") {
      const cancellationStarted = performance.now();
      await page.getByRole("button", { name: "Create PDF" }).click();
      await page.getByRole("button", { name: "Cancel generation" }).click();
      await page.getByRole("button", { name: "Create PDF" }).waitFor();
      await eventually(
        async () =>
          (await page.evaluate(() => window.imageBenchmarkMetrics.workers)) ===
          0,
      );
      cancellationMs = Math.round(performance.now() - cancellationStarted);
    }
    const generationStarted = performance.now();
    await page.getByRole("button", { name: "Create PDF" }).click();
    const link = page.getByRole("link", { name: "Download PDF" });
    await link.waitFor({ timeout: 120_000 });
    const generationMs = performance.now() - generationStarted;
    const pending = page.waitForEvent("download");
    await link.click();
    const download = await pending;
    const outputPath = path.join(scratch, `${scenario.name}.pdf`);
    await download.saveAs(outputPath);
    const output = await readFile(outputPath);
    const metricsBeforeReset = await page.evaluate(
      () => window.imageBenchmarkMetrics,
    );
    const heapWithResult = await page.evaluate(
      () => performance.memory?.usedJSHeapSize ?? null,
    );
    await page.screenshot({
      path: path.join(scratch, `${scenario.name}.png`),
      fullPage: false,
    });
    await page.getByRole("button", { name: "Start over" }).click();
    await eventually(async () => {
      const metrics = await page.evaluate(() => window.imageBenchmarkMetrics);
      return metrics.liveUrls === 0 && metrics.workers === 0;
    });
    assert.deepEqual(unexpected, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      true,
    );
    rows.push({
      scenario: scenario.name,
      imageCount: scenario.images.length,
      aggregatePixels: scenario.images.reduce(
        (sum, image) => sum + image.width * image.height,
        0,
      ),
      previewMs: Math.round(previewMs),
      generationMs: Math.round(generationMs),
      cancellationMs,
      outputBytes: output.byteLength,
      peakLiveObjectUrls: metricsBeforeReset.peakUrls,
      observedHeapDeltaBytes:
        heapBefore === null || heapWithResult === null
          ? null
          : heapWithResult - heapBefore,
      cleanup: "0 live object URLs; 0 workers",
      horizontalOverflow: false,
    });
    await context.close();
  }
  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        browser: "project-pinned Playwright Chromium",
        workload:
          "Synthetic phone-size JPEGs, transparent PNGs, a 24 MP boundary image, and the 20-image count boundary",
        rows,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
  server.kill();
}
