import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inspectPagesWithCrop } from "../../../packages/pdf-browser/tests/helpers/pdf-assertions";
import { expect, test } from "./fixtures";

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );

type Audit = {
  requests: { url: string; method: string; body: string | null }[];
  consoleMessages: string[];
};

async function beginAudit(page: Page, context: BrowserContext): Promise<Audit> {
  const requests: Audit["requests"] = [];
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
    (
      window as unknown as { pageToolResources: typeof counts }
    ).pageToolResources = counts;
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

async function assertLocalAndClean(
  page: Page,
  audit: Audit,
  baseURL: string,
  canary: string,
) {
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              pageToolResources: {
                workers: number;
                urls: number;
                peakWorkers: number;
              };
            }
          ).pageToolResources,
      ),
    )
    .toMatchObject({ workers: 0, urls: 0 });
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0 });
  expect(audit.requests.length).toBeGreaterThan(0);
  expect(
    audit.requests.every(
      ({ url, method, body }) =>
        new URL(url).origin === new URL(baseURL).origin &&
        method === "GET" &&
        body === null,
    ),
  ).toBe(true);
  expect(JSON.stringify(audit.requests)).not.toContain(canary);
  expect(JSON.stringify(audit.consoleMessages)).not.toContain(canary);
  expect(audit.consoleMessages).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            pageToolResources: { peakWorkers: number };
          }
        ).pageToolResources.peakWorkers,
    ),
  ).toBeLessThanOrEqual(2);
}

test("FR-EXT-001: selected pages export in displayed order and remain local", async ({
  page,
  context,
  baseURL,
}) => {
  const canary = "PRIVATE-EXTRACT-NAME";
  const audit = await beginAudit(page, context);
  await page.goto("/extract-pdf-pages");
  await expect(
    page.locator(".tool-heading").getByText("Processed on your device", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Choose PDF").setInputFiles({
    name: `${canary}.pdf`,
    mimeType: "application/pdf",
    buffer: await readFile(fixture("preview-features.pdf")),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
    timeout: 15_000,
  });
  const exportButton = page.getByRole("button", {
    name: "Export selected pages",
  });
  await expect(exportButton).toBeDisabled();
  await expect(page.getByText("Select at least one page")).toBeVisible();
  await page.getByLabel("Select source page 4 for extraction").check();
  await page.getByLabel("Select source page 2 for extraction").check();
  await expect(page.getByText("2 of 4 pages selected")).toBeVisible();
  await expect(
    page.locator('li[data-source-page="2"] .page-selection-state'),
  ).toHaveText("Selected for extraction");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await exportButton.click();
  const link = page.getByRole("link", { name: "Download extracted pages" });
  await expect(link).toBeVisible();
  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("extracted-pages.pdf");
  const output = await inspectPagesWithCrop(
    new Uint8Array(await readFile((await download.path())!)),
  );
  expect(output.map(({ marker }) => marker)).toEqual(["P2", "P4"]);
  expect(output.map(({ rotation }) => rotation)).toEqual([0, 90]);
  expect(output[1].crop).toEqual({ x: 40, y: 50, width: 420, height: 560 });
  await page.getByRole("button", { name: "Start over" }).click();
  await assertLocalAndClean(page, audit, baseURL!, canary);
});

test("FR-DEL-001: exact complement exports and deleting all is blocked", async ({
  page,
  context,
  baseURL,
}) => {
  const canary = "PRIVATE-DELETE-NAME";
  const audit = await beginAudit(page, context);
  await page.goto("/delete-pdf-pages");
  await page.getByLabel("Choose PDF").setInputFiles({
    name: `${canary}.pdf`,
    mimeType: "application/pdf",
    buffer: await readFile(fixture("preview-features.pdf")),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Select all pages" }).click();
  await expect(
    page.getByText("At least one page must remain", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export remaining pages" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page.getByLabel("Mark source page 2 for removal").check();
  await page.getByLabel("Mark source page 4 for removal").check();
  await expect(
    page.locator('li[data-source-page="4"] .page-selection-state'),
  ).toHaveText("Marked for removal");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Export remaining pages" }).click();
  const link = page.getByRole("link", { name: "Download remaining pages" });
  await expect(link).toBeVisible();
  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("pages-removed.pdf");
  const output = await inspectPagesWithCrop(
    new Uint8Array(await readFile((await download.path())!)),
  );
  expect(output.map(({ marker }) => marker)).toEqual(["P1", "P3"]);
  expect(output.map(({ rotation }) => rotation)).toEqual([0, 0]);
  await page.getByRole("button", { name: "Start over" }).click();
  await assertLocalAndClean(page, audit, baseURL!, canary);
});

test("FR-ROT-001/002: selected and all rotations agree with reopened output", async ({
  page,
  context,
  baseURL,
}) => {
  const canary = "PRIVATE-ROTATE-NAME";
  const audit = await beginAudit(page, context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/rotate-pdf");
  await page.getByLabel("Choose PDF").setInputFiles({
    name: `${canary}.pdf`,
    mimeType: "application/pdf",
    buffer: await readFile(fixture("preview-features.pdf")),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
    timeout: 15_000,
  });
  await page.getByLabel("Select source page 1 for rotation").check();
  await page.getByLabel("Select source page 2 for rotation").check();
  await page.getByRole("button", { name: "Rotate selected right" }).click();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page.getByLabel("Select source page 4 for rotation").check();
  await page.getByRole("button", { name: "Rotate selected left" }).click();
  await page.getByRole("button", { name: "Rotate all right" }).click();
  await expect(
    page.locator('li[data-source-page="1"] .rotation-state'),
  ).toContainText("+180°");
  await expect(
    page.locator('li[data-source-page="4"] .rotation-state'),
  ).toContainText("0°");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Export rotated PDF" }).click();
  const link = page.getByRole("link", { name: "Download rotated PDF" });
  await expect(link).toBeVisible();
  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("rotated.pdf");
  const output = await inspectPagesWithCrop(
    new Uint8Array(await readFile((await download.path())!)),
  );
  expect(output.map(({ marker }) => marker)).toEqual(["P1", "P2", "P3", "P4"]);
  expect(output.map(({ rotation }) => rotation)).toEqual([180, 180, 90, 90]);
  await page.getByRole("button", { name: "Start over" }).click();
  await assertLocalAndClean(page, audit, baseURL!, canary);
});

for (const route of [
  "/extract-pdf-pages",
  "/delete-pdf-pages",
  "/rotate-pdf",
]) {
  test(`${route} recovers from encrypted and corrupt source replacement`, async ({
    page,
  }) => {
    await page.goto(route);
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
}
