import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inspectPages } from "../../../packages/pdf-browser/tests/helpers/pdf-assertions";
import { largePreview } from "../../../packages/pdf-browser/tests/helpers/large-preview";

test("render failure has a safe thumbnail state and replacement recovers", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args
    ) {
      if (
        (window as unknown as { failFoundationCanvas?: boolean })
          .failFoundationCanvas
      )
        throw new Error("synthetic canvas failure");
      return Reflect.apply(original, this, args);
    } as typeof original;
  });
  await page.goto("/");
  await page.evaluate(() => {
    (
      window as unknown as { failFoundationCanvas?: boolean }
    ).failFoundationCanvas = true;
  });
  await page
    .getByLabel("Choose test PDF")
    .setInputFiles(fixture("preview-features.pdf"));
  await expect(page.getByRole("status")).toContainText("4 pages ready");
  await expect(
    page.getByText("Preview unavailable", { exact: true }).first(),
  ).toBeVisible();
  expect(
    await page
      .locator("canvas")
      .first()
      .evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height),
  ).toBe(0);
  await expect(
    page.getByRole("link", { name: "Download test PDF" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (
      window as unknown as { failFoundationCanvas?: boolean }
    ).failFoundationCanvas = false;
  });
  await page
    .getByLabel("Choose test PDF")
    .setInputFiles(fixture("preview-features.pdf"));
  await expect(page.getByRole("status")).toContainText("4 pages ready");
  await expect(
    page.getByText("Preview unavailable", { exact: true }),
  ).toHaveCount(0);
});

test("200-page scrolling stays bounded and over-limit replacement is rejected", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Choose test PDF").setInputFiles({
    name: "large-synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await largePreview(200)),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(200);
  for (const number of [1, 100, 200, 1]) {
    const row = page.locator(`li[data-source-page="${number}"]`);
    await row.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        row
          .locator("canvas")
          .evaluate(
            (canvas: HTMLCanvasElement) => canvas.width * canvas.height,
          ),
      )
      .toBeGreaterThan(0);
    const stats = await page.evaluate(() =>
      (
        window as unknown as {
          foundationStats: () => {
            active: number;
            retained: number;
            canvasPixels: number;
          };
        }
      ).foundationStats(),
    );
    expect(stats.active).toBeLessThanOrEqual(1);
    expect(stats.retained).toBeLessThanOrEqual(8);
    expect(stats.canvasPixels).toBeLessThanOrEqual(8 * 307200);
  }
  await page
    .getByRole("button", { name: "Reset test session", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.getByLabel("Choose test PDF").setInputFiles({
    name: "over-limit.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await largePreview(201)),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "PAGE_LIMIT",
  );
  await expect(page.locator("canvas")).toHaveCount(0);
});

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );
test("test configuration is required; noindex and discovery boundaries", async ({
  page,
  request,
}) => {
  const disabled = await request.get("http://127.0.0.1:3102/");
  expect(disabled.status()).toBe(404);
  const response = await page.goto("/");
  expect(response!.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  expect((await request.get("/sitemap.xml")).status()).toBe(404);
});

test("stable selection, keyboard reorder, rotation, extract and validated download", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Choose test PDF")
    .setInputFiles(fixture("preview-features.pdf"));
  await expect(page.getByRole("status")).toContainText("4 pages ready");
  const ids = await page
    .locator("li[data-page-id]")
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset.pageId),
    );
  await page
    .getByRole("checkbox", { name: "Select page 4", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Rotate selected", exact: true })
    .click();
  for (let n = 0; n < 3; n++) {
    const move = page.getByRole("button", {
      name: "Move page 4 earlier",
      exact: true,
    });
    await move.focus();
    await page.keyboard.press("Enter");
  }
  await expect(
    page.getByRole("button", { name: "Move page 4 later", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("checkbox", { name: "Select page 4", exact: true }),
  ).toBeChecked();
  expect(
    await page.locator("li[data-page-id]").first().getAttribute("data-page-id"),
  ).toBe(ids[3]);
  await page
    .getByRole("checkbox", { name: "Select page 1", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Retain selected", exact: true })
    .click();
  await expect(page.locator("li[data-page-id]")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Export test PDF", exact: true })
    .click();
  const link = page.getByRole("link", { name: "Download test PDF" });
  await expect(link).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await link.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("pages.pdf");
  const pages = await inspectPages(
    new Uint8Array(await readFile((await download.path())!)),
  );
  expect(pages.map(({ marker }) => marker)).toEqual(["P4", "P1"]);
  expect(pages.map(({ rotation }) => rotation)).toEqual([180, 0]);
  await page.getByRole("button", { name: "Rotate all", exact: true }).click();
  await expect(link).toHaveCount(0);
});

test("thumbnail association, crop and rotation; accessible mobile reflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByLabel("Choose test PDF")
    .setInputFiles(fixture("preview-features.pdf"));
  const first = page.locator('li[data-source-page="1"]');
  await expect(first).toBeVisible();
  await first.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      first
        .locator("canvas")
        .evaluate((node: HTMLCanvasElement) => node.width * node.height),
    )
    .toBeGreaterThan(0);
  await expect(first.getByText("Rendering preview…")).toHaveCount(0);
  const fourth = page.locator('li[data-source-page="4"]');
  await expect(fourth.getByText("Preview waits until nearby")).toBeVisible();
  const idleHeight = (await fourth.boundingBox())!.height;
  await fourth.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      fourth
        .locator("canvas")
        .evaluate(
          (node: HTMLCanvasElement) =>
            node.width > node.height && node.height > 0,
        ),
    )
    .toBe(true);
  expect(
    Math.abs((await fourth.boundingBox())!.height - idleHeight),
  ).toBeLessThan(1);
  const before = await fourth
    .locator("canvas")
    .evaluate((node: HTMLCanvasElement) => [node.width, node.height]);
  await fourth.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Rotate selected", exact: true })
    .click();
  await fourth.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      fourth
        .locator("canvas")
        .evaluate(
          (node: HTMLCanvasElement) =>
            node.height > node.width && node.width > 0,
        ),
    )
    .toBe(true);
  expect(before[0]).toBeGreaterThan(before[1]);
  await expect(fourth.getByText("Rendering preview…")).toHaveCount(0);
  const redTop = await fourth
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (data[i] > 180 && data[i + 1] < 70 && data[i + 2] < 70) count++;
        }
      return count;
    });
  expect(redTop).toBeGreaterThan(10);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("delete complement and invalid deletion preserve recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Choose test PDF")
    .setInputFiles(fixture("preview-features.pdf"));
  await expect(page.locator("li[data-page-id]")).toHaveCount(4);
  for (let n = 1; n <= 4; n++)
    await page
      .getByRole("checkbox", { name: `Select page ${n}`, exact: true })
      .check();
  await page
    .getByRole("button", { name: "Delete selected", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "INVALID_PLAN",
  );
  await expect(page.locator("li[data-page-id]")).toHaveCount(4);
  await page
    .getByRole("checkbox", { name: "Select page 2", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Delete selected", exact: true })
    .click();
  await expect(page.locator("li[data-page-id]")).toHaveCount(1);
  await expect(page.locator("li[data-page-id]")).toHaveAttribute(
    "data-source-page",
    "2",
  );
});

test("local privacy, warmed offline operation, replacement and cleanup", async ({
  page,
  context,
  browserName,
}) => {
  const requests: { url: string; method: string }[] = [],
    consoleTypes: string[] = [];
  context.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() }),
  );
  page.on("console", (event) => {
    if (["warning", "error"].includes(event.type()))
      consoleTypes.push(`${event.type()}: ${event.text()}`);
  });
  await page.addInitScript(() => {
    const counts = { active: 0, peak: 0, urls: 0 };
    (window as unknown as { resourceCounts: typeof counts }).resourceCounts =
      counts;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private ended = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        counts.active++;
        counts.peak = Math.max(counts.peak, counts.active);
      }
      terminate() {
        if (!this.ended) {
          this.ended = true;
          counts.active--;
        }
        super.terminate();
      }
    };
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
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
  await page.goto("/");
  await page.getByLabel("Choose test PDF").setInputFiles({
    name: "PRIVATE-FONT-CHECK.pdf",
    mimeType: "application/pdf",
    buffer: await readFile(fixture("preview-features.pdf")),
  });
  await expect(page.getByRole("status")).toContainText("4 pages ready");
  const firstIds = await page
    .locator("li[data-page-id]")
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset.pageId),
    );
  // Warm every page's fonts and the structural worker before going offline.
  for (const row of await page.locator("li[data-page-id]").all()) {
    await row.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        row.locator("canvas").evaluate((node: HTMLCanvasElement) => node.width),
      )
      .toBeGreaterThan(0);
    await expect(row.getByText("Rendering preview…")).toHaveCount(0);
  }
  await page
    .getByRole("button", { name: "Export test PDF", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download test PDF" }),
  ).toBeVisible();
  await context.setOffline(true);
  const offlineBlobReadable = await page.evaluate(async () => {
    try {
      await new Blob(["synthetic probe"]).arrayBuffer();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotReadableError")
        return false;
      throw error;
    }
  });
  await page.getByRole("button", { name: "Rotate all", exact: true }).click();
  await page
    .getByRole("button", { name: "Export test PDF", exact: true })
    .click();
  if (offlineBlobReadable) {
    await expect(
      page.getByRole("link", { name: "Download test PDF" }),
    ).toBeVisible();
  } else {
    // WebKit's simulated offline mode can reject local Blob reads too.
    // Assert safe failure, not a successful offline operation or a skipped test.
    expect(browserName).toBe("webkit");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "INVALID_PDF",
    );
    await expect(
      page.getByRole("link", { name: "Download test PDF" }),
    ).toHaveCount(0);
  }
  await context.setOffline(false);
  if (!offlineBlobReadable) {
    await page
      .getByRole("button", { name: "Export test PDF", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Download test PDF" }),
    ).toBeVisible();
  }
  await page
    .getByLabel("Choose test PDF")
    .setInputFiles(fixture("preview-features.pdf"));
  await expect(page.getByRole("status")).toContainText("4 pages ready");
  const nextIds = await page
    .locator("li[data-page-id]")
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset.pageId),
    );
  expect(nextIds.some((id) => firstIds.includes(id))).toBe(false);
  await page
    .getByRole("button", { name: "Reset test session", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { resourceCounts: { active: number } })
            .resourceCounts.active,
      ),
    )
    .toBe(0);
  const counts = await page.evaluate(
    () =>
      (window as unknown as { resourceCounts: { peak: number; urls: number } })
        .resourceCounts,
  );
  expect(counts.peak).toBeLessThanOrEqual(2);
  expect(counts.urls).toBe(0);
  expect(
    requests.every(
      ({ url, method }) =>
        new URL(url).origin === "http://127.0.0.1:3101" && method === "GET",
    ),
  ).toBe(true);
  expect(JSON.stringify(requests)).not.toContain("PRIVATE-FONT-CHECK");
  expect(requests.some(({ url }) => /LiberationSans/.test(url))).toBe(true);
  const expectedOfflineDiagnostic =
    "error: Failed to load resource: WebKit encountered an internal error";
  if (!offlineBlobReadable) {
    expect(browserName).toBe("webkit");
    expect(consoleTypes).toContain(expectedOfflineDiagnostic);
  }
  expect(
    consoleTypes.filter(
      (message) =>
        !(
          !offlineBlobReadable &&
          browserName === "webkit" &&
          message === expectedOfflineDiagnostic
        ),
    ),
  ).toEqual([]);
});

test("encrypted/corrupt source fails safely and reset permits replacement", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Choose test PDF")
    .setInputFiles(fixture("encrypted.pdf"));
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "ENCRYPTED_PDF",
  );
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.getByLabel("Choose test PDF").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-broken"),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "INVALID_PDF",
  );
  await page.getByLabel("Choose test PDF").setInputFiles(fixture("form.pdf"));
  await expect(page.getByRole("status")).toContainText("1 pages ready");
});
