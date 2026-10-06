import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inspectPagesWithCrop } from "../../../packages/pdf-browser/tests/helpers/pdf-assertions";
import { inspectZip } from "../../../packages/pdf-browser/tests/helpers/zip-assertions";
import { expect, test } from "./fixtures";

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );

async function choose(page: Page, name = "split-source.pdf") {
  await page.getByLabel("Choose PDF").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: await readFile(fixture("preview-features.pdf")),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
    timeout: 15_000,
  });
}

async function downloadBytes(page: Page, linkName: string, filename: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: linkName }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(filename);
  return new Uint8Array(await readFile((await download.path())!));
}

async function beginAudit(page: Page, context: BrowserContext) {
  const requests: Array<{ url: string; method: string; body: string | null }> =
    [];
  const consoleMessages: string[] = [];
  context.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    }),
  );
  context.on("console", (event) =>
    consoleMessages.push(`${event.type()}: ${event.text()}`),
  );
  await page.addInitScript(() => {
    const counts = { workers: 0, peakWorkers: 0, urls: 0 };
    (window as unknown as { splitResources: typeof counts }).splitResources =
      counts;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private ended = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        counts.workers++;
        counts.peakWorkers = Math.max(counts.peakWorkers, counts.workers);
      }
      terminate() {
        if (!this.ended) {
          this.ended = true;
          counts.workers--;
        }
        super.terminate();
      }
    };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    const live = new Set<string>();
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      live.add(url);
      counts.urls = live.size;
      return url;
    };
    URL.revokeObjectURL = (url) => {
      live.delete(url);
      counts.urls = live.size;
      revoke(url);
    };
  });
  return { requests, consoleMessages };
}

async function archiveChunkName() {
  const directory = fileURLToPath(
    new URL("../.next/static/chunks/", import.meta.url),
  );
  const matches: string[] = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".js")) continue;
    if (
      (await readFile(`${directory}/${name}`, "utf8")).includes(
        "unknown compression type",
      )
    )
      matches.push(name);
  }
  expect(matches).toHaveLength(1);
  return matches[0];
}

test("FR-SPL-001/002/004: range groups allow cross-group reuse and download one validated ZIP locally", async ({
  page,
  context,
  baseURL,
}) => {
  const canary = "PRIVATE-SPLIT-FILENAME";
  const audit = await beginAudit(page, context);
  const archiveChunk = await archiveChunkName();
  await page.goto("/split-pdf");
  await expect(
    page.locator(".tool-heading").getByText("Processed on your device", {
      exact: true,
    }),
  ).toBeVisible();
  await choose(page, `${canary}.pdf`);
  await page.getByLabel("Output 1 page ranges").fill("1-3");
  await page.getByRole("button", { name: "Add output group" }).click();
  await expect(page.getByLabel("Output 2 page ranges")).toBeFocused();
  await page.getByLabel("Output 2 page ranges").fill("3-4");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Generate split files" }).click();
  await expect(
    page.getByRole("heading", { name: "Your split ZIP is ready" }),
  ).toBeVisible();
  expect(
    audit.requests.some(({ url }) => url.endsWith(`/${archiveChunk}`)),
  ).toBe(true);
  const bytes = await downloadBytes(
    page,
    "Download split ZIP",
    "split-pdf-files.zip",
  );
  const entries = inspectZip(bytes);
  expect(Object.keys(entries)).toEqual(["split-01.pdf", "split-02.pdf"]);
  const first = await inspectPagesWithCrop(entries["split-01.pdf"]);
  const second = await inspectPagesWithCrop(entries["split-02.pdf"]);
  expect(first.map(({ marker }) => marker)).toEqual(["P1", "P2", "P3"]);
  expect(second.map(({ marker }) => marker)).toEqual(["P3", "P4"]);
  expect(second[1]).toMatchObject({
    rotation: 90,
    crop: { x: 40, y: 50, width: 420, height: 560 },
  });
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              splitResources: { workers: number; urls: number };
            }
          ).splitResources,
      ),
    )
    .toMatchObject({ workers: 0, urls: 0 });
  expect(
    audit.requests.every(
      ({ url, method, body }) =>
        new URL(url).origin === new URL(baseURL!).origin &&
        method === "GET" &&
        body === null,
    ),
  ).toBe(true);
  expect(JSON.stringify(audit)).not.toContain(canary);
  expect(audit.consoleMessages).toEqual([]);
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0 });
});

test("FR-SPL-003: one range group downloads a PDF without loading archive code", async ({
  page,
  context,
}) => {
  const archiveChunk = await archiveChunkName();
  const requests: string[] = [];
  context.on("request", (request) => requests.push(request.url()));
  await page.goto("/split-pdf");
  await choose(page);
  await page.getByLabel("Output 1 page ranges").fill("2,4");
  await page.getByRole("button", { name: "Generate split files" }).click();
  await expect(
    page.getByRole("heading", { name: "Your split PDF is ready" }),
  ).toBeVisible();
  expect(requests.some((url) => url.endsWith(`/${archiveChunk}`))).toBe(false);
  const output = await inspectPagesWithCrop(
    await downloadBytes(page, "Download split PDF", "split-01.pdf"),
  );
  expect(output.map(({ marker }) => marker)).toEqual(["P2", "P4"]);
});

test("FR-SPL-001: group validation is local, associated, and allows recovery", async ({
  page,
}) => {
  await page.goto("/split-pdf");
  await choose(page);
  const input = page.getByLabel("Output 1 page ranges");
  await input.fill("1-3,3");
  await page.getByRole("button", { name: "Generate split files" }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/Page 3 appears more than once/)).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("5");
  await page.getByRole("button", { name: "Generate split files" }).click();
  await expect(page.getByText(/Page 5 does not exist/)).toBeVisible();
  await input.fill("4");
  await page.getByRole("button", { name: "Generate split files" }).click();
  await expect(
    page.getByRole("heading", { name: "Your split PDF is ready" }),
  ).toBeVisible();
});

test("FR-SPL-002: selected pages become separate PDFs in source order", async ({
  page,
}) => {
  await page.goto("/split-pdf");
  await choose(page);
  await page.getByLabel("Individual selected pages").check();
  await page.getByLabel("Select source page 4 as a separate PDF").check();
  await page.getByLabel("Select source page 2 as a separate PDF").check();
  await expect(
    page.getByText(/2 pages will become 2 separate PDF files/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Generate split files" }).click();
  const entries = inspectZip(
    await downloadBytes(page, "Download split ZIP", "split-pdf-files.zip"),
  );
  expect(Object.keys(entries)).toEqual(["split-01.pdf", "split-02.pdf"]);
  expect(
    (await inspectPagesWithCrop(entries["split-01.pdf"])).map(
      ({ marker }) => marker,
    ),
  ).toEqual(["P2"]);
  expect(
    (await inspectPagesWithCrop(entries["split-02.pdf"])).map(
      ({ marker }) => marker,
    ),
  ).toEqual(["P4"]);
});

test("Split PDF recovers from encrypted and corrupt source replacement", async ({
  page,
}) => {
  await page.goto("/split-pdf");
  await page.getByLabel("Choose PDF").setInputFiles(fixture("encrypted.pdf"));
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Password-protected",
  );
  await page.getByLabel("Choose another PDF").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-broken"),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "damaged or unsupported",
  );
  await page
    .getByLabel("Choose another PDF")
    .setInputFiles(fixture("preview-features.pdf"));
  await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
    timeout: 15_000,
  });
});
