// Synthetic local benchmark for M3B.3 PDF to Text. It records no source
// filenames or document data. All inputs are project-authored synthetic
// fixtures. The benchmark exercises bounded preview rendering, Copy and
// Download, and the no-text/partial behaviour.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const scratch = path.join(root, ".tools/pdf-to-text-review");
const resultPath = path.join(
  root,
  "docs/benchmarks/M3B3-pdf-to-text-results.json",
);
await mkdir(scratch, { recursive: true });

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument } = pdfRequire("pdf-lib");

const previewFixture = await readFile(
  path.join(root, "tests/fixtures/pdf/preview-features.pdf"),
);
const partialFixture = await readFile(
  path.join(root, "tests/fixtures/pdf/text-partial.pdf"),
);
const xssFixture = await readFile(
  path.join(root, "tests/fixtures/pdf/text-xss.pdf"),
);
const scannedFixture = await readFile(
  path.join(root, "tests/fixtures/pdf/text-scanned.pdf"),
);

// A 50-page bounded-page-count PDF with no text content. Used only to confirm
// the preview and extraction paths still behave at the engineering boundary.
async function largeFixture() {
  const document = await PDFDocument.create();
  const helvetica = await document.embedStandardFont("Helvetica");
  for (let page = 0; page < 50; page++) {
    const sheet = document.addPage([612, 792]);
    sheet.drawText(`Benchmark page ${page + 1}`, {
      x: 60,
      y: 720,
      size: 14,
      font: helvetica,
    });
  }
  return Buffer.from(await document.save());
}

const port = 3115;
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
    return (await fetch(`${origin}/pdf-to-text`)).ok;
  } catch {
    return false;
  }
});

const browser = await chromium.launch({ headless: true });
const cases = [];

const canaries = [
  "SOURCE-FILENAME-CANARY",
  "Synthetic preview fixture",
  "Benchmark page",
];
const audit = {
  totalRequests: 0,
  crossOrigin: 0,
  nonGet: 0,
  canaryLeaks: 0,
  webSockets: 0,
  consoleCanaryLeaks: 0,
  storageEntries: 0,
};

async function measure(name, buffer, expect) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  context.on("request", (request) => {
    requests.push({ url: request.url(), method: request.method() });
    audit.totalRequests += 1;
    if (!request.url().startsWith(origin) && !request.url().startsWith("blob:"))
      audit.crossOrigin += 1;
    if (!["GET", "HEAD"].includes(request.method())) audit.nonGet += 1;
    const haystack = [
      request.url(),
      request.postData() ?? "",
      JSON.stringify(request.headers()),
    ].join("\n");
    if (canaries.some((canary) => haystack.includes(canary)))
      audit.canaryLeaks += 1;
  });
  context.on("console", (message) => {
    if (canaries.some((canary) => message.text().includes(canary)))
      audit.consoleCanaryLeaks += 1;
  });
  page.on("websocket", () => (audit.webSockets += 1));
  const started = performance.now();
  await page.goto(`${origin}/pdf-to-text`);
  await page.getByLabel("Choose PDF").setInputFiles({
    name: "SOURCE-FILENAME-CANARY.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await page
    .getByText(
      expect === "no-text" ? "No text layer was found" : "Extracted text ready",
    )
    .waitFor({ timeout: 60_000 });
  const ready = performance.now();
  const previewText =
    expect === "no-text"
      ? ""
      : await page.locator(".pdf-text-preview").innerText();
  audit.storageEntries += await page.evaluate(
    () => localStorage.length + sessionStorage.length,
  );
  await context.close();
  cases.push({
    case: name,
    expect,
    readyMs: Math.round(ready - started),
    previewCharacters: previewText.length,
    sameOriginRequests: requests.every(
      (request) =>
        new URL(request.url).origin === origin && request.method === "GET",
    ),
  });
}

try {
  await measure(
    "preview-features (4 pages, embedded fonts)",
    previewFixture,
    "text",
  );
  await measure("text-partial (text + blank + text)", partialFixture, "text");
  await measure("text-xss (literal script tokens)", xssFixture, "text");
  await measure("text-scanned (image-only)", scannedFixture, "no-text");
  await measure(
    "large-50 (page boundary, numbered text)",
    await largeFixture(),
    "text",
  );
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    browser: "chromium (Playwright)",
    cases,
    requestAudit: audit,
  };
  await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
  for (const key of [
    "crossOrigin",
    "nonGet",
    "canaryLeaks",
    "webSockets",
    "consoleCanaryLeaks",
    "storageEntries",
  ])
    assert.equal(audit[key], 0, `${key} must be 0`);
  for (const row of cases) {
    assert.equal(
      row.sameOriginRequests,
      true,
      `${row.case} requests must be first-party`,
    );
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
