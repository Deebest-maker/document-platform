// Uses the already-locked Vitest/Vite bundler and Playwright; no new benchmark framework.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = await import(
  pathToFileURL(createRequire(require.resolve("vitest")).resolve("vite")).href
);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const direct = process.argv.includes("--main-thread");
const boundary = process.argv.includes("--boundary");
const output = path.join(root, ".tools/merge-benchmarks");
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
      entry: path.join(
        root,
        direct
          ? "packages/pdf-browser/src/merge.ts"
          : "packages/pdf-browser/src/index.ts",
      ),
      formats: ["es"],
      fileName: () => "engine.js",
    },
  },
});
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><title>Local synthetic benchmark</title><input type="file" multiple><button>Focus probe</button><script type="module">import * as engine from "/engine.js"; window.MergeEngine = engine;</script>',
    );
    return;
  }
  const target = path.resolve(bundle, "." + pathname);
  if (!target.startsWith(bundle + path.sep)) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.setHeader("Content-Type", "text/javascript");
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const browser = await chromium.launch();
let cases = JSON.parse(await readFile(path.join(output, "cases.json"), "utf8"));
if (boundary) {
  const text = cases.find((item) => item.label === "text-50");
  const images = cases.find((item) => item.label === "images-10");
  cases = [
    {
      label: "engineering-pages-and-count",
      files: Array.from({ length: 20 }, (_, index) => text.files[index % 5]),
      pages: 200,
      inputBytes: text.inputBytes * 4,
    },
    {
      label: "engineering-near-byte-cap",
      files: [...images.files, ...images.files, ...images.files],
      pages: 30,
      inputBytes: images.inputBytes * 3,
    },
  ];
}
const rows = [];
try {
  for (const throttle of [1, 4]) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    for (const item of cases) {
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.waitForFunction(() => Boolean(window.MergeEngine));
      await page
        .locator("input")
        .setInputFiles(item.files.map((name) => path.join(output, name)));
      for (let repeat = 0; repeat < 3; repeat++) {
        const measured = await page.evaluate(async (bounded) => {
          const tasks = [];
          const observer = new PerformanceObserver((list) =>
            tasks.push(...list.getEntries()),
          );
          observer.observe({ type: "longtask", buffered: false });
          let maxDelay = 0;
          let previous = performance.now();
          const timer = setInterval(() => {
            const now = performance.now();
            maxDelay = Math.max(maxDelay, now - previous - 16);
            previous = now;
          }, 16);
          const start = performance.now();
          const inputs = Array.from(document.querySelector("input").files).map(
            (blob, index) => ({ id: String(index), blob }),
          );
          // Boundary runs use the selected engineering caps. Other runs explore beyond them.
          const limits = bounded
            ? {
                maxFiles: 20,
                maxFileBytes: 10 * 1024 * 1024,
                maxTotalBytes: 32 * 1024 * 1024,
                maxPages: 200,
                maxOutputBytes: 32 * 1024 * 1024,
              }
            : {
                maxFiles: 100,
                maxFileBytes: 128 * 1024 * 1024,
                maxTotalBytes: 256 * 1024 * 1024,
                maxPages: 1000,
                maxOutputBytes: 256 * 1024 * 1024,
              };
          const result = await window.MergeEngine.mergePdfs(inputs, limits);
          const durationMs = performance.now() - start;
          await new Promise((resolve) => setTimeout(resolve, 30));
          clearInterval(timer);
          observer.disconnect();
          return {
            durationMs: Math.round(durationMs),
            maxDelayMs: Math.round(maxDelay),
            longTasks: tasks.length,
            longestTaskMs: Math.round(
              Math.max(0, ...tasks.map((task) => task.duration)),
            ),
            outputBytes: result.blob.size,
            pages: result.pageCount,
          };
        }, boundary);
        if (measured.pages !== item.pages)
          throw new Error("Benchmark page count mismatch");
        rows.push({
          case: item.label,
          throttle,
          repeat,
          files: item.files.length,
          inputBytes: item.inputBytes,
          ...measured,
        });
      }
      console.log(
        JSON.stringify({ case: item.label, throttle, results: rows.slice(-3) }),
      );
    }
    await page.close();
  }
  const report = {
    engine: direct ? "main-thread" : "worker",
    throttleScope:
      "Page main thread only; worker CPU is not emulated. Not a physical mobile benchmark.",
    date: new Date().toISOString(),
    platform: process.platform,
    cpu: os.cpus()[0].model,
    memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
    browser: browser.version(),
    rows,
  };
  await writeFile(
    path.join(
      output,
      boundary ? "boundary.json" : direct ? "main-thread.json" : "worker.json",
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
