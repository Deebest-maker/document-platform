// Isolated, explicitly invoked licensing experiment. Not an application route.
// Only project-authored synthetic fixtures are opened. Never serve PDF bytes.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium, firefox, webkit } = requireWeb("@playwright/test");
const requirePdf = createRequire(
  new URL("../packages/pdf-browser/package.json", import.meta.url),
);
const dist = path.dirname(requirePdf.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(
  await readFile(path.join(dist, "package.json"), "utf8"),
);
if (version !== "6.3.289")
  throw new Error("Review the font experiment before upgrading PDF.js.");
const assets = path.join(root, "apps/web/public/vendor/pdfjs", version);
const alternative = process.argv.includes("--ofl");
const alternativeFonts = path.join(
  root,
  "packages/pdf-browser/assets/liberation-sans/2.1.5",
);
const fontHashes = {
  "LiberationSans-Regular.ttf":
    "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8",
  "LiberationSans-Bold.ttf":
    "788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173",
  "LiberationSans-Italic.ttf":
    "e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0",
  "LiberationSans-BoldItalic.ttf":
    "698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee",
};
if (alternative) {
  for (const [file, hash] of Object.entries(fontHashes)) {
    const bytes = await readFile(path.join(alternativeFonts, file));
    if (createHash("sha256").update(bytes).digest("hex") !== hash)
      throw new Error("Alternative font hash mismatch.");
  }
}
const out = path.join(
  root,
  alternative ? ".tools/m2b-font-alternative" : ".tools/m2b-font-gate",
);
await mkdir(out, { recursive: true });

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>Synthetic font gate</title></head><body><input type="file"><div id="pages"></div></body></html>',
    );
    return;
  }
  let target;
  if (pathname === "/pdf.mjs" || pathname === "/pdf.worker.mjs") {
    target = path.join(dist, "build", pathname.slice(1));
  } else if (pathname.startsWith("/assets/")) {
    // Keep the licensing gate closed even if an unrelated local task puts
    // excluded files in the generated directory after preparation.
    const fontName = pathname.slice("/assets/standard_fonts/".length);
    if (
      alternative &&
      pathname.startsWith("/assets/standard_fonts/") &&
      Object.hasOwn(fontHashes, fontName)
    ) {
      response.setHeader("Content-Type", "font/ttf");
      response.end(await readFile(path.join(alternativeFonts, fontName)));
      return;
    }
    if (/Liberation|quickjs/i.test(pathname)) {
      response.writeHead(404).end();
      return;
    }
    target = path.resolve(assets, pathname.slice("/assets/".length));
    if (!target.startsWith(assets + path.sep)) {
      response.writeHead(404).end();
      return;
    }
  } else {
    response.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(target);
    response.setHeader(
      "Content-Type",
      /\.m?js$/.test(target)
        ? "text/javascript"
        : target.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream",
    );
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const [browserName, browserType] of Object.entries({
    chromium,
    firefox,
    webkit,
  })) {
    const browser = await browserType.launch();
    try {
      for (const useSystemFonts of alternative ? [false] : [true, false]) {
        for (const fixture of [
          "preview-features.pdf",
          "form.pdf",
          "font-clipping.pdf",
          ...(alternative ? ["font-variants.pdf"] : []),
        ]) {
          const page = await browser.newPage({
            viewport: { width: 800, height: 900 },
          });
          page.setDefaultTimeout(20000);
          const requests = [],
            failedAssets = [],
            consoleEvents = [];
          page.on("request", (request) =>
            requests.push({
              path: new URL(request.url()).pathname,
              method: request.method(),
              local: new URL(request.url()).origin === origin,
            }),
          );
          page.on("response", (response) => {
            if (response.status() >= 400)
              failedAssets.push({
                path: new URL(response.url()).pathname,
                status: response.status(),
              });
          });
          // Never persist arbitrary library messages or document content.
          page.on("console", (event) => consoleEvents.push(event.type()));
          await page.goto(origin);
          await page
            .locator("input")
            .setInputFiles(path.join(root, "tests/fixtures/pdf", fixture));
          const pages = await page.evaluate(
            async ({ useSystemFonts, disableFontFace }) => {
              const lib = await import("/pdf.mjs");
              const nativeWorker = new Worker("/pdf.worker.mjs", {
                type: "module",
              });
              const worker = new lib.PDFWorker({
                port: nativeWorker,
                verbosity: 0,
              });
              const data = new Uint8Array(
                await document.querySelector("input").files[0].arrayBuffer(),
              );
              const task = lib.getDocument({
                data,
                worker,
                verbosity: 0,
                enableXfa: false,
                stopAtErrors: true,
                useSystemFonts,
                disableFontFace,
                cMapUrl: "/assets/cmaps/",
                standardFontDataUrl: "/assets/standard_fonts/",
                wasmUrl: "/assets/wasm/",
                iccUrl: "/assets/iccs/",
              });
              try {
                const doc = await task.promise;
                const evidence = [];
                for (let number = 1; number <= doc.numPages; number++) {
                  const pdfPage = await doc.getPage(number);
                  const viewport = pdfPage.getViewport({ scale: 1 });
                  const canvas = document.createElement("canvas");
                  canvas.style.display = "block";
                  canvas.width = viewport.width;
                  canvas.height = viewport.height;
                  document.getElementById("pages").append(canvas);
                  await pdfPage.render({ canvas, viewport }).promise;
                  const pixels = canvas
                    .getContext("2d")
                    .getImageData(0, 0, canvas.width, canvas.height).data;
                  let bluePixels = 0;
                  for (let i = 0; i < pixels.length; i += 4) {
                    if (
                      pixels[i] < 80 &&
                      pixels[i + 1] < 80 &&
                      pixels[i + 2] > 170 &&
                      pixels[i + 3] > 200
                    )
                      bluePixels++;
                  }
                  evidence.push({
                    sourcePageNumber: number,
                    width: canvas.width,
                    height: canvas.height,
                    rotation: pdfPage.rotate,
                    bluePixels,
                  });
                  pdfPage.cleanup();
                }
                return evidence;
              } finally {
                try {
                  await task.destroy();
                } finally {
                  try {
                    worker.destroy();
                  } finally {
                    nativeWorker.terminate();
                  }
                }
              }
            },
            { useSystemFonts, disableFontFace: alternative },
          );
          for (let index = 0; index < pages.length; index++) {
            await page
              .locator("canvas")
              .nth(index)
              .screenshot({
                path: path.join(
                  out,
                  `${browserName}-system-${useSystemFonts}-${fixture}-${index + 1}.png`,
                ),
              });
          }
          const clippingCorrect = [
            "font-clipping.pdf",
            "font-variants.pdf",
          ].includes(fixture)
            ? pages.every(
                ({ bluePixels }) => bluePixels > 500 && bluePixels < 20000,
              )
            : null;
          results.push({
            browser: browserName,
            browserVersion: browser.version(),
            platform: process.platform,
            fixture,
            useSystemFonts,
            disableFontFace: alternative,
            pages,
            clippingCorrect,
            requests,
            failedAssets,
            consoleEvents,
          });
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
await writeFile(
  path.join(out, "results.json"),
  JSON.stringify(
    {
      pdfjs: version,
      alternative: alternative
        ? "Liberation Sans 2.1.5 OFL-1.1, useSystemFonts:false, disableFontFace:true"
        : null,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    results.map(
      ({
        browser,
        fixture,
        useSystemFonts,
        clippingCorrect,
        failedAssets,
      }) => ({
        browser,
        fixture,
        useSystemFonts,
        clippingCorrect,
        missingAssets: failedAssets.length,
      }),
    ),
  ),
);
if (results.some(({ clippingCorrect }) => clippingCorrect === false))
  process.exitCode = 1;
if (
  alternative &&
  results.some(
    ({ requests, failedAssets, consoleEvents }) =>
      failedAssets.length ||
      consoleEvents.length ||
      requests.some(({ local, method }) => !local || method !== "GET"),
  )
)
  process.exitCode = 1;
