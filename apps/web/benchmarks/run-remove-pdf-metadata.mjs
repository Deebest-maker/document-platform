// Synthetic local benchmark for M3B.4 Remove PDF Metadata. It records no
// source filenames or document data. All inputs are project-authored
// synthetic fixtures. The benchmark exercises before/after metadata
// presence, the trailer /ID spike outcome, and the download path.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const scratch = path.join(root, ".tools/remove-pdf-metadata-review");
const resultPath = path.join(
  root,
  "docs/benchmarks/M3B4-remove-pdf-metadata-results.json",
);
await mkdir(scratch, { recursive: true });

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument } = pdfRequire("pdf-lib");

const metadataRichFixture = await readFile(
  path.join(root, "tests/fixtures/pdf/metadata-rich.pdf"),
);

async function makeMinimalPdf({ pages }) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`p${i + 1}`, { x: 40, y: 700 });
  }
  return doc.save({ useObjectStreams: false });
}

const noMetadataFixture = Buffer.from(await makeMinimalPdf({ pages: 1 }));

const port = 3100 + Math.floor(Math.random() * 100);
const origin = `http://127.0.0.1:${port}`;
// Production server (matches the other benchmarks); requires `pnpm build`.
const nextBin = path.join(webRoot, "node_modules/next/dist/bin/next");
const server = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  { cwd: webRoot, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));
for (let attempt = 0; ; attempt++) {
  if (server.exitCode !== null)
    throw new Error(`Next exited before readiness: ${serverLog}`);
  try {
    if ((await fetch(`${origin}/remove-pdf-metadata`)).ok) break;
  } catch {
    /* not ready yet */
  }
  if (attempt > 600) throw new Error("Next did not become ready");
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const scenarios = {};
const requestAudit = {
  totalRequests: 0,
  crossOrigin: 0,
  nonGet: 0,
  canaryLeaks: 0,
  webSockets: 0,
  consoleCanaryLeaks: 0,
  storageEntries: 0,
};
const canaries = [
  "SECRET-TITLE-CANARY",
  "SECRET-AUTHOR-CANARY",
  "ACME-INTERNAL-CANARY",
  "XMP-CANARY",
  "SOURCE-FILENAME-CANARY",
];
context.on("request", (request) => {
  const url = request.url();
  requestAudit.totalRequests += 1;
  if (!url.startsWith(origin) && !url.startsWith("blob:"))
    requestAudit.crossOrigin += 1;
  if (request.method() !== "GET" && request.method() !== "HEAD")
    requestAudit.nonGet += 1;
  const haystack = [
    url,
    request.postData() ?? "",
    JSON.stringify(request.headers()),
  ].join("\n");
  if (canaries.some((canary) => haystack.includes(canary)))
    requestAudit.canaryLeaks += 1;
});
context.on("console", (message) => {
  if (canaries.some((canary) => message.text().includes(canary)))
    requestAudit.consoleCanaryLeaks += 1;
});
page.on("websocket", () => (requestAudit.webSockets += 1));

async function runScenario(name, buffer) {
  const openStart = Date.now();
  await page.goto(`${origin}/remove-pdf-metadata`);
  const openMs = Date.now() - openStart;
  const extractStart = Date.now();
  await page.getByLabel("Choose a PDF to clean").setInputFiles({
    name: "SOURCE-FILENAME-CANARY.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await page
    .getByRole("heading", { name: "Cleaned PDF ready" })
    .waitFor({ timeout: 60_000 });
  const extractionMs = Date.now() - extractStart;
  const link = await page.getByRole("link", { name: /download cleaned pdf/i });
  const href = await link.getAttribute("href");
  const cells = async (row) =>
    page.getByRole("row", { name: row }).getByRole("cell").allInnerTexts();
  const standardInfo = await cells(/Standard Info entries/);
  const customInfo = await cells(/Custom Info entries/);
  const xmp = await cells(/XMP metadata stream/);
  const trailerId = await cells(/Trailer identifier/);
  const trailerNote = await page
    .locator(".remove-metadata-trailer-note")
    .count();
  scenarios[name] = {
    openMs,
    processMs: extractionMs,
    standardInfoBeforeAfter: standardInfo,
    customInfoBeforeAfter: customInfo,
    xmpBeforeAfter: xmp,
    trailerIdPresentBeforeAfter: trailerId,
    downloadFilename: await link.getAttribute("download"),
    downloadIsBlob: href?.startsWith("blob:") ?? false,
    trailerIdControllableReported: trailerNote === 0,
  };
}

try {
  await runScenario("metadata-rich", metadataRichFixture);
  await runScenario("no-metadata", noMetadataFixture);
  requestAudit.storageEntries = await page.evaluate(
    () => localStorage.length + sessionStorage.length,
  );
} finally {
  await context.close();
  await browser.close();
  server.kill("SIGTERM");
}

const results = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  browser: "chromium (Playwright)",
  scenarios,
  requestAudit,
};
await writeFile(resultPath, JSON.stringify(results, null, 2));

assert.equal(requestAudit.crossOrigin, 0, "no cross-origin requests");
assert.equal(requestAudit.nonGet, 0, "no non-GET requests");
assert.equal(requestAudit.canaryLeaks, 0, "no canary leaks");
assert.equal(requestAudit.consoleCanaryLeaks, 0, "no console canary leaks");
assert.equal(requestAudit.webSockets, 0, "no WebSockets");
assert.equal(requestAudit.storageEntries, 0, "no web storage");
console.log("M3B.4 Remove PDF Metadata benchmark written to", resultPath);
