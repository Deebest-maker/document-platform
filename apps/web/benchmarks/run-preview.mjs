// Synthetic, local-only engineering measurements. No production instrumentation.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const require = createRequire(import.meta.url);
const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument } = pdfRequire("pdf-lib");
const { build } = await import(
  pathToFileURL(createRequire(require.resolve("vitest")).resolve("vite")).href
);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(root, ".tools/preview-benchmarks");
const bundle = path.join(output, "bundle");
await mkdir(bundle, { recursive: true });
await build({
  configFile: false,
  logLevel: "error",
  worker: { format: "es" },
  build: {
    outDir: bundle,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: path.join(root, "apps/web/benchmarks/preview-entry.ts"),
      formats: ["es"],
      fileName: () => "engine.js",
    },
  },
});
const source = await PDFDocument.load(
  await readFile(path.join(root, "tests/fixtures/pdf/preview-features.pdf")),
);
const cases = [];
for (const count of [10, 50, 100, 200, 201]) {
  const doc = await PDFDocument.create();
  for (const page of await doc.copyPages(
    source,
    Array.from({ length: count }, (_, i) => i % 4),
  ))
    doc.addPage(page);
  const filename = path.join(output, `mixed-${count}.pdf`);
  await writeFile(filename, await doc.save());
  cases.push({ label: `mixed-${count}`, filename, pages: count });
}
// Eight unique deterministic RGB images, reused across 50 pages. Generated, never committed.
const upng = createRequire(pdfRequire.resolve("pdf-lib"))(
  "@pdf-lib/upng",
).default;
const images = await PDFDocument.create();
let seed = 31;
const embedded = [];
for (let n = 0; n < 8; n++) {
  const pixels = new Uint8Array(512 * 512 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed & 255;
    pixels[i + 1] = (seed >>> 8) & 255;
    pixels[i + 2] = (seed >>> 16) & 255;
    pixels[i + 3] = 255;
  }
  embedded.push(
    await images.embedPng(upng.encode([pixels.buffer], 512, 512, 0)),
  );
}
for (let n = 0; n < 50; n++)
  images
    .addPage([500, 650])
    .drawImage(embedded[n % 8], { x: 0, y: 0, width: 500, height: 650 });
const imageFile = path.join(output, "images-50.pdf");
await writeFile(imageFile, await images.save());
cases.push({ label: "images-50", filename: imageFile, pages: 50 });
const vendor = path.join(root, "apps/web/public");
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><title>Synthetic preview benchmark</title><input type="file"><script type="module">import * as engine from "/engine.js";window.engine=engine;</script>',
    );
    return;
  }
  const base = pathname.startsWith("/vendor/") ? vendor : bundle,
    target = path.resolve(base, "." + pathname);
  if (!target.startsWith(base + path.sep)) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      /\.m?js$/.test(pathname)
        ? "text/javascript"
        : pathname.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream",
    );
    res.end(await readFile(target));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const memoryOnly = process.argv.includes("--memory");
const browser = await chromium.launch(
  memoryOnly ? { args: ["--enable-precise-memory-info"] } : {},
);
const rows = [];
try {
  for (const mobile of [false, true])
    for (const concurrency of memoryOnly ? [1] : [1, 2, 4])
      for (const item of memoryOnly
        ? cases.filter((item) =>
            ["mixed-200", "images-50"].includes(item.label),
          )
        : cases) {
        const context = await browser.newContext({
          viewport: mobile
            ? { width: 390, height: 844 }
            : { width: 1280, height: 900 },
          deviceScaleFactor: mobile ? 3 : 1,
          isMobile: mobile,
        });
        await context.addInitScript(() => {
          const Original = window.Worker;
          window.workers = { live: 0, peak: 0 };
          window.Worker = class extends Original {
            constructor(...args) {
              super(...args);
              window.workers.live++;
              window.workers.peak = Math.max(
                window.workers.peak,
                window.workers.live,
              );
              this.ended = false;
            }
            terminate() {
              if (!this.ended) {
                this.ended = true;
                window.workers.live--;
              }
              return super.terminate();
            }
          };
        });
        const page = await context.newPage();
        const unexpected = [];
        context.on("request", (r) => {
          if (
            !r.url().startsWith(origin) ||
            r.method() !== "GET" ||
            r.postData()
          )
            unexpected.push("request");
        });
        page.on("pageerror", () => unexpected.push("pageerror"));
        await page.goto(origin);
        await page.waitForFunction(() => Boolean(window.engine));
        await page.locator("input").setInputFiles(item.filename);
        const result = await page.evaluate(
          async ({ concurrency, pages }) => {
            const e = window.engine,
              file = document.querySelector("input").files[0];
            const tasks = [];
            const observer = new PerformanceObserver((list) =>
              tasks.push(...list.getEntries()),
            );
            observer.observe({ type: "longtask", buffered: false });
            const start = performance.now();
            let preview;
            try {
              preview = await Promise.race([
                e.openPreview({ id: "benchmark", blob: file }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(Error("open timeout")), 30000),
                ),
              ]);
            } catch (error) {
              observer.disconnect();
              return {
                error: error.code ?? error.message,
                workers: window.workers.live,
              };
            }
            const openMs = performance.now() - start;
            const scheduler = new e.ThumbnailScheduler(preview, concurrency),
              canvases = Array.from({ length: pages }, () => {
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = 0;
                return canvas;
              });
            let firstMs,
              peakPixels = 0,
              peakRetained = 0;
            const sample = () => {
              const s = scheduler.stats();
              peakPixels = Math.max(peakPixels, s.canvasPixels);
              peakRetained = Math.max(peakRetained, s.retained);
            };
            const timer = setInterval(sample, 5);
            async function batch(offset, rotation = 0) {
              const requests = canvases
                .slice(offset, offset + 8)
                .map((canvas, i) => ({
                  id: `p${offset + i}`,
                  sourcePageNumber: offset + i + 1,
                  rotationDelta: rotation,
                  revision: String(rotation),
                  canvas,
                  size: { width: 240, height: 320, dpr: devicePixelRatio },
                  onState: (state) => {
                    if (state === "ready" && firstMs === undefined)
                      firstMs = performance.now() - start;
                  },
                }));
              scheduler.update(requests);
              const until = performance.now() + 30000;
              while (
                scheduler.stats().active ||
                scheduler.stats().completed < 0
              ) {
                if (performance.now() > until) throw Error("batch timeout");
                await new Promise((resolve) => setTimeout(resolve, 5));
                sample();
              }
              if (requests.some(({ canvas }) => !canvas.width))
                throw Error("missing preview");
              sample();
            }
            await batch(0);
            const firstBatchMs = performance.now() - start;
            const heaps = [];
            for (let cycle = 0; cycle < 3; cycle++) {
              await batch(pages - 8);
              await batch(0, 90);
              await batch(0);
              heaps.push(performance.memory?.usedJSHeapSize ?? null);
            }
            // Begin a new render revision, then pause before structural work.
            const pending = batch(pages - 8, 90);
            const cancelStart = performance.now();
            await scheduler.pause();
            const cancelMs = performance.now() - cancelStart;
            await pending.catch(() => {});
            const pausedActive = scheduler.stats().active;
            const transformed = await e.transformPages(
              { id: "benchmark", blob: file },
              e.createPagePlan(pages, "benchmark"),
              e.pageLimits,
            );
            const outputBytes = transformed.blob.size;
            scheduler.resume();
            await batch(0);
            clearInterval(timer);
            const stats = scheduler.stats();
            await scheduler.destroy();
            await preview.destroy();
            observer.disconnect();
            return {
              openMs,
              firstMs,
              firstBatchMs,
              cancelMs,
              peakPixels,
              peakRetained,
              peakActive: stats.peakActive,
              pausedActive,
              outputBytes,
              workerPeak: window.workers.peak,
              workersAfter: window.workers.live,
              pixelsAfter: canvases.reduce((n, c) => n + c.width * c.height, 0),
              heapSamples: heaps,
              longTasks: tasks.length,
              longestTaskMs: Math.max(0, ...tasks.map((t) => t.duration)),
              inputBytes: file.size,
            };
          },
          { concurrency, pages: item.pages },
        );
        assert.equal(unexpected.length, 0);
        if (item.pages === 201) {
          assert.equal(result.error, "PAGE_LIMIT");
          assert.equal(result.workers, 0);
        } else {
          assert.equal(result.workersAfter, 0);
          assert.equal(result.pixelsAfter, 0);
          assert.equal(result.pausedActive, 0);
          assert(result.workerPeak <= 2);
          assert(result.peakActive <= concurrency);
          assert(result.peakRetained <= 8);
          assert(result.peakPixels <= 8 * 307200);
        }
        rows.push({
          case: item.label,
          mobileEmulation: mobile,
          requestedDpr: mobile ? 3 : 1,
          concurrency,
          ...result,
        });
        console.log(JSON.stringify(rows.at(-1)));
        await context.close();
      }
  await writeFile(
    path.join(
      root,
      `docs/benchmarks/M2B-preview-${memoryOnly ? "memory" : "results"}.json`,
    ),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        platform: process.platform,
        cpu: os.cpus()[0].model,
        memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
        preciseHeapSampling: memoryOnly,
        scope:
          "Synthetic Chromium desktop and mobile viewport/DPR emulation; no physical mobile evidence. Heap samples are approximate JS heap, not total PDF.js or GPU memory.",
        rows,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
