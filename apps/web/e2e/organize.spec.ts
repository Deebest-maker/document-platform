import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inspectPagesWithCrop } from "../../../packages/pdf-browser/tests/helpers/pdf-assertions";
import { expect, test } from "./fixtures";

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );

test("FR-ORG-001/002: keyboard reorder exports the exact displayed order", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/organize-pdf");
  await expect(
    page.getByRole("heading", { name: "Organize PDF" }),
  ).toBeVisible();
  await expect(
    page.getByText("Processed on your device", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await page
    .getByLabel("Choose PDF")
    .setInputFiles(fixture("preview-features.pdf"));
  await expect(page.locator("li[data-page-id]")).toHaveCount(4);

  const pageOneLater = page.getByRole("button", {
    name: "Move page 1 later",
    exact: true,
  });
  await pageOneLater.focus();
  await page.keyboard.press("Enter");
  await expect(pageOneLater).toBeFocused();
  await page.keyboard.press("Enter");
  const pageFourEarlier = page.getByRole("button", {
    name: "Move page 4 earlier",
    exact: true,
  });
  await pageFourEarlier.focus();
  await page.keyboard.press("Enter");
  await expect(pageFourEarlier).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(pageFourEarlier).toBeFocused();

  expect(
    await page
      .locator("li[data-source-page]")
      .evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.sourcePage),
      ),
  ).toEqual(["2", "4", "3", "1"]);
  await expect(page.getByRole("status")).toContainText(
    "Source page 4 moved to position 2 of 4",
  );
  await page.getByRole("button", { name: "Export organized PDF" }).click();
  const link = page.getByRole("link", { name: "Download organized PDF" });
  await expect(link).toBeVisible();
  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("organized.pdf");
  const output = new Uint8Array(await readFile((await download.path())!));
  const pages = await inspectPagesWithCrop(output);
  expect(pages.map(({ marker }) => marker)).toEqual(["P2", "P4", "P3", "P1"]);
  expect(pages.map(({ rotation }) => rotation)).toEqual([0, 90, 0, 0]);
  expect(pages.map(({ width, height }) => [width, height])).toEqual([
    [500, 650],
    [500, 650],
    [500, 650],
    [500, 650],
  ]);
  expect(pages[1].crop).toEqual({ x: 40, y: 50, width: 420, height: 560 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

test("FR-PRV-001: complete local workflow releases workers, canvases and URLs", async ({
  page,
  context,
  baseURL,
}) => {
  const requests: { url: string; method: string; body: string | null }[] = [];
  context.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    }),
  );
  await page.addInitScript(() => {
    const counts = { workers: 0, peakWorkers: 0, urls: 0 };
    (
      window as unknown as { organizeResources: typeof counts }
    ).organizeResources = counts;
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
  await page.goto("/organize-pdf");
  await page.getByLabel("Choose PDF").setInputFiles({
    name: "PRIVATE-ORGANIZE-NAME.pdf",
    mimeType: "application/pdf",
    buffer: await readFile(fixture("preview-features.pdf")),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Move page 1 later", exact: true })
    .click();
  await page.getByRole("button", { name: "Export organized PDF" }).click();
  const link = page.getByRole("link", { name: "Download organized PDF" });
  await expect(link).toBeVisible();
  const pending = page.waitForEvent("download");
  await link.click();
  await pending;
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              organizeResources: { workers: number; urls: number };
            }
          ).organizeResources,
      ),
    )
    .toMatchObject({ workers: 0, urls: 0 });
  const resources = await page.evaluate(
    () =>
      (
        window as unknown as {
          organizeResources: { peakWorkers: number };
        }
      ).organizeResources,
  );
  expect(resources.peakWorkers).toBeLessThanOrEqual(2);
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every(
      ({ url, method, body }) =>
        new URL(url).origin === new URL(baseURL!).origin &&
        method === "GET" &&
        body === null,
    ),
  ).toBe(true);
  expect(JSON.stringify(requests)).not.toContain("PRIVATE-ORGANIZE-NAME");
});

test("safe errors recover through source replacement", async ({ page }) => {
  await page.goto("/organize-pdf");
  await page.getByLabel("Choose PDF").setInputFiles(fixture("encrypted.pdf"));
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Password-protected",
  );
  await expect(page.locator("canvas")).toHaveCount(0);
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
  await expect(page.locator("li[data-page-id]")).toHaveCount(4);
});
