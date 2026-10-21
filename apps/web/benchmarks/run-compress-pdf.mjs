// Production benchmark for M5A Compress PDF.
//
// Drives the real /compress-pdf page of the production build in headless
// Chromium (file chooser -> strength -> Compress -> download), exactly as a
// person would, so the numbers include the worker, the image codec and the
// verification pass. Inputs are the synthetic corpus written by
// tests/fixtures/generate_compress_benchmark.py plus the committed synthetic
// fixtures; no user data and no source filenames are recorded beyond those
// synthetic ids.
//
//   pnpm build
//   uv run ... python tests/fixtures/generate_compress_benchmark.py
//   node apps/web/benchmarks/run-compress-pdf.mjs [--only=B01,C01] [--profiles=balanced]
//   uv run ... python tests/fixtures/evaluate_compress_benchmark.py
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const work = path.join(root, ".tools/compress-benchmarks");
const outDir = path.join(work, "out");
const resultPath = path.join(
  root,
  "docs/benchmarks/M5A-compress-pdf-results.json",
);
await mkdir(outDir, { recursive: true });

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v = "true"] = a.slice(2).split("=");
      return [k, v];
    }),
);
const only = args.only ? args.only.split(",") : undefined;
const profileFilter = args.profiles ? args.profiles.split(",") : undefined;
const RUN_TIMEOUT_MS = 8 * 60_000;

// ---- case list -----------------------------------------------------------
const cases = [];
async function addDirectory(dir, group, profiles) {
  let names = [];
  try {
    names = (await readdir(path.join(work, dir))).filter((n) =>
      n.endsWith(".pdf"),
    );
  } catch {
    return;
  }
  for (const name of names.sort())
    cases.push({
      id: name.replace(/\.pdf$/, ""),
      group,
      source: path.join(work, dir, name),
      profiles,
    });
}
await addDirectory("corpus", "corpus", ["light", "balanced", "strong"]);
await addDirectory("stress", "stress", ["balanced"]);
for (const name of [
  "a.pdf",
  "form.pdf",
  "signed.pdf",
  "preview-features.pdf",
  "metadata-rich.pdf",
  "font-variants.pdf",
  "encrypted.pdf",
  "corrupt.pdf",
]) {
  cases.push({
    id: `F-${name.replace(/\.pdf$/, "")}`,
    group: "fixtures",
    source: path.join(root, "tests/fixtures/pdf", name),
    profiles: ["balanced"],
  });
}
// Variance: repeat three representative files.
const repeated = new Set(["B01-office-photos", "C01-scan-color-jpeg"]);

// ---- server --------------------------------------------------------------
const port = 3300 + Math.floor(Math.random() * 100);
const origin = `http://127.0.0.1:${port}`;
const nextBin = path.join(webRoot, "node_modules/next/dist/bin/next");
const server = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  { cwd: webRoot, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout.on("data", (c) => (serverLog += c));
server.stderr.on("data", (c) => (serverLog += c));
for (let attempt = 0; ; attempt++) {
  if (server.exitCode !== null)
    throw new Error(`Next exited before readiness: ${serverLog}`);
  try {
    if ((await fetch(`${origin}/compress-pdf`)).ok) break;
  } catch {
    /* not ready yet */
  }
  if (attempt > 600) throw new Error("Next did not become ready");
  await new Promise((r) => setTimeout(r, 100));
}

// ---- measurement helpers -------------------------------------------------
function rendererRssMiB() {
  let sum = 0;
  let pids = [];
  try {
    pids = readdirSync("/proc").filter((x) => /^\d+$/.test(x));
  } catch {
    return 0;
  }
  for (const pid of pids) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!cmd.includes("--type=renderer")) continue;
      const m = readFileSync(`/proc/${pid}/status`, "utf8").match(
        /VmHWM:\s+(\d+)/,
      );
      if (m) sum += Number(m[1]) / 1024;
    } catch {
      /* process ended */
    }
  }
  return sum;
}
const headings = {
  reduced: "Compressed PDF ready",
  "no-reduction": "This PDF is already well compressed",
  error: "This PDF could not be compressed",
};

const browser = await chromium.launch({ headless: true });
const runs = [];
const audit = {
  requests: 0,
  crossOrigin: 0,
  nonGet: 0,
  webSockets: 0,
  consoleErrors: 0,
  pageErrors: 0,
};

async function runOne(testCase, profile, repeat) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  context.on("request", (request) => {
    audit.requests++;
    if (
      !request.url().startsWith(origin) &&
      !/^(blob|data|about):/.test(request.url())
    )
      audit.crossOrigin++;
    if (!["GET", "HEAD"].includes(request.method())) audit.nonGet++;
  });
  page.on("websocket", () => audit.webSockets++);
  page.on("console", (m) => {
    if (m.type() === "error") audit.consoleErrors++;
  });
  page.on("pageerror", () => audit.pageErrors++);
  await page.goto(`${origin}/compress-pdf`);

  const sourceBytes = (await stat(testCase.source)).size;
  const row = {
    id: testCase.id,
    group: testCase.group,
    profile,
    repeat,
    sourcePath: path.relative(root, testCase.source),
    inputBytes: sourceBytes,
  };
  await page
    .getByLabel("Choose a PDF to compress")
    .setInputFiles(testCase.source);
  const compressButton = page.getByRole("button", {
    name: "Compress PDF",
    exact: true,
  });
  const selected = page.getByRole("heading", {
    name: "Choose how much to compress",
  });
  try {
    await selected.waitFor({ timeout: 60_000 });
  } catch {
    // Files rejected before selection (for example over the size limit).
    row.outcome = "error";
    row.error = (await page.locator("[data-state-heading]").first().innerText())
      .slice(0, 80)
      .trim();
    row.errorText = (await page.locator("main").innerText())
      .replace(/\s+/g, " ")
      .slice(0, 300);
    await context.close();
    return row;
  }
  await page
    .getByRole("radio", { name: new RegExp(`^${profile}`, "i") })
    .check();

  let peak = 0;
  const timer = setInterval(() => {
    peak = Math.max(peak, rendererRssMiB());
  }, 100);
  const started = performance.now();
  await compressButton.click();
  const outcome = await Promise.race(
    Object.entries(headings).map(([key, name]) =>
      page
        .getByRole("heading", { name })
        .waitFor({ timeout: RUN_TIMEOUT_MS })
        .then(() => key),
    ),
  ).catch(() => "timeout");
  row.wallMs = Math.round(performance.now() - started);
  clearInterval(timer);
  peak = Math.max(peak, rendererRssMiB());
  row.outcome = outcome;
  row.peakRendererRssMiB = Math.round(peak);

  if (outcome === "reduced") {
    const link = page.getByRole("link", { name: "Download compressed PDF" });
    const pending = page.waitForEvent("download");
    await link.click();
    const saved = await pending;
    const target = path.join(outDir, `${testCase.id}.${profile}.${repeat}.pdf`);
    await copyFile(await saved.path(), target);
    row.outputBytes = (await stat(target)).size;
    row.outputPath = path.relative(root, target);
    row.shownSaving = await page.locator(".compress-saving").innerText();
    row.shownChanges = await page.locator(".compress-changes").innerText();
    const unchanged = page.locator(".compress-unchanged li");
    row.shownUnchanged = await unchanged.allInnerTexts();
    const warnings = page.locator(".compress-warnings li");
    row.shownWarnings = await warnings.allInnerTexts();
  } else if (outcome === "no-reduction") {
    row.outputBytes = null;
    row.hasDownloadLink =
      (await page
        .getByRole("link", { name: "Download compressed PDF" })
        .count()) > 0;
  } else if (outcome === "error") {
    row.errorText = (await page.locator("main").innerText())
      .replace(/\s+/g, " ")
      .slice(0, 300);
  }
  await context.close();
  return row;
}

const profilesOf = (c) =>
  profileFilter
    ? c.profiles.filter((p) => profileFilter.includes(p))
    : c.profiles;

for (const testCase of cases) {
  if (only && !only.some((o) => testCase.id.startsWith(o))) continue;
  for (const profile of profilesOf(testCase)) {
    const repeats = repeated.has(testCase.id) && profile === "balanced" ? 3 : 1;
    for (let repeat = 1; repeat <= repeats; repeat++) {
      let row;
      try {
        row = await runOne(testCase, profile, repeat);
      } catch (error) {
        row = {
          id: testCase.id,
          profile,
          repeat,
          outcome: "harness-error",
          error: String(error).slice(0, 200),
        };
      }
      runs.push(row);
      console.log(
        JSON.stringify({
          id: row.id,
          profile,
          outcome: row.outcome,
          in: row.inputBytes,
          out: row.outputBytes,
          ms: row.wallMs,
          rss: row.peakRendererRssMiB,
        }),
      );
    }
  }
}

const version = browser.version();
await browser.close();
server.kill();

const cpus = os.cpus();
await writeFile(
  resultPath,
  JSON.stringify(
    {
      milestone: "M5A",
      generatedAt: new Date().toISOString(),
      environment: {
        chromium: version,
        node: process.version,
        platform: `${os.platform()} ${os.release()}`,
        cpu: `${cpus[0]?.model ?? "unknown"} x${cpus.length}`,
        memoryGiB: Math.round(os.totalmem() / 2 ** 30),
        headless: true,
        note: "Single cold run per case unless repeat > 1; desktop Chromium on a shared cloud VM. Not a public performance or memory guarantee.",
      },
      privacyAudit: audit,
      runs,
    },
    null,
    1,
  ) + "\n",
);
console.log(`wrote ${path.relative(root, resultPath)} (${runs.length} runs)`);
