import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inspectPages } from "../../../packages/pdf-browser/tests/helpers/pdf-assertions";
import { expect, test } from "./fixtures";

async function raster(
  page: Page,
  width: number,
  height: number,
  color: string,
  mimeType: "image/jpeg" | "image/png",
) {
  return Buffer.from(
    await page.evaluate(
      async ({ width, height, color, mimeType }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d")!;
        if (mimeType === "image/png") {
          context.clearRect(0, 0, width, height);
          context.fillStyle = color;
          context.fillRect(
            Math.floor(width / 4),
            Math.floor(height / 4),
            Math.ceil(width / 2),
            Math.ceil(height / 2),
          );
        } else {
          context.fillStyle = color;
          context.fillRect(0, 0, width, height);
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, Math.ceil(width / 3), Math.ceil(height / 3));
        }
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("fixture"))),
            mimeType,
            0.92,
          ),
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      },
      { width, height, color, mimeType },
    ),
  );
}

function withExifOrientation(jpeg: Buffer, orientation: number) {
  const app1 = Buffer.from([
    0xff,
    0xe1,
    0x00,
    0x22,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

async function downloadPdf(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("images-to-pdf.pdf");
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
    const counts = { workers: 0, urls: 0, peakUrls: 0 };
    (window as unknown as { imageResources: typeof counts }).imageResources =
      counts;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private ended = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        counts.workers++;
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
      counts.peakUrls = Math.max(counts.peakUrls, counts.urls);
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

test("FR-I2P-001/002/004: local previews, C A B reorder, valid ordered PDF, and cleanup", async ({
  page,
  context,
  baseURL,
}) => {
  const audit = await beginAudit(page, context);
  await page.goto("/jpg-to-pdf");
  await expect(
    page
      .locator(".tool-heading")
      .getByText("Processed on your device", { exact: true }),
  ).toBeVisible();
  const files = [
    {
      name: "PRIVATE-A.jpg",
      mimeType: "image/jpeg",
      buffer: await raster(page, 120, 80, "#dc2626", "image/jpeg"),
    },
    {
      name: "PRIVATE-B.png",
      mimeType: "image/png",
      buffer: await raster(page, 80, 160, "#16a34a", "image/png"),
    },
    {
      name: "PRIVATE-C.jpg",
      mimeType: "image/jpeg",
      buffer: await raster(page, 200, 100, "#2563eb", "image/jpeg"),
    },
  ];
  await page.getByLabel("Choose images").setInputFiles(files);
  await expect(page.locator(".image-card img")).toHaveCount(3);
  await page.getByRole("button", { name: "Move image 3 earlier" }).click();
  await page.getByRole("button", { name: "Move image 2 earlier" }).click();
  await expect(page.locator(".image-card strong")).toHaveText([
    "PRIVATE-C.jpg",
    "PRIVATE-A.jpg",
    "PRIVATE-B.png",
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(
    page.getByRole("heading", { name: "Your image PDF is ready" }),
  ).toBeVisible();
  const bytes = await downloadPdf(page);
  expect(await inspectPages(bytes)).toMatchObject([
    { width: 150, height: 75 },
    { width: 90, height: 60 },
    { width: 60, height: 120 },
  ]);
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(
    page.getByRole("button", { name: "Choose images" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              imageResources: { workers: number; urls: number };
            }
          ).imageResources,
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
  expect(JSON.stringify(audit)).not.toContain("PRIVATE-");
  expect(audit.consoleMessages).toEqual([]);
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0 });
});

test("FR-I2P-003: page size, fit disclosure, orientation, and EXIF 6 normalization", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/jpg-to-pdf");
  const source = withExifOrientation(
    await raster(page, 120, 200, "#7c3aed", "image/jpeg"),
    6,
  );
  await page.getByLabel("Choose images").setInputFiles({
    name: "oriented.jpg",
    mimeType: "image/jpeg",
    buffer: source,
  });
  await expect(page.locator(".image-card img")).toHaveCount(1);
  await expect(page.locator(".image-card .small-copy").first()).toContainText(
    "200 × 120 px",
  );
  await page.getByLabel("Cover — fill the page").check();
  await expect(
    page.getByText("Cover preserves proportions but may crop image edges."),
  ).toBeVisible();
  await page.getByLabel("Contain — show the entire image").check();
  await page.getByRole("button", { name: "Create PDF" }).click();
  expect(await inspectPages(await downloadPdf(page))).toMatchObject([
    { width: 150, height: 90 },
  ]);

  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByLabel("Choose images").setInputFiles({
    name: "page-size.png",
    mimeType: "image/png",
    buffer: await raster(page, 100, 200, "#0f766e", "image/png"),
  });
  await expect(page.locator(".image-card img")).toHaveCount(1);
  await page.getByLabel("A4").check();
  await page.getByLabel("Landscape").check();
  await page.getByRole("button", { name: "Create PDF" }).click();
  const [size] = await inspectPages(await downloadPdf(page));
  expect(size.width).toBeCloseTo((297 / 25.4) * 72, 4);
  expect(size.height).toBeCloseTo((210 / 25.4) * 72, 4);

  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByLabel("Choose images").setInputFiles({
    name: "letter.jpg",
    mimeType: "image/jpeg",
    buffer: await raster(page, 200, 100, "#a16207", "image/jpeg"),
  });
  await expect(page.locator(".image-card img")).toHaveCount(1);
  await page.getByRole("radio", { name: "Letter", exact: true }).check();
  await page.getByLabel("Portrait").check();
  await page.getByRole("button", { name: "Create PDF" }).click();
  expect(await inspectPages(await downloadPdf(page))).toMatchObject([
    { width: 612, height: 792 },
  ]);
});

test("representative EXIF orientations are interpreted consistently", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/jpg-to-pdf");
  const base = await raster(page, 120, 200, "#be123c", "image/jpeg");
  for (const [index, orientation] of [2, 3, 6, 8].entries()) {
    await page
      .getByLabel(index === 0 ? "Choose images" : "Add more images")
      .setInputFiles({
        name: `orientation-${orientation}.jpg`,
        mimeType: "image/jpeg",
        buffer: withExifOrientation(base, orientation),
      });
    await expect(page.locator(".image-card img")).toHaveCount(index + 1);
  }
  await expect(page.locator(".image-card img")).toHaveCount(4);
  await expect(page.locator(".image-card .small-copy")).toContainText([
    "120 × 200 px",
    "120 × 200 px",
    "200 × 120 px",
    "200 × 120 px",
  ]);
});

test("image validation rejects wrong declarations and malformed signatures with recovery", async ({
  page,
}) => {
  await page.goto("/jpg-to-pdf");
  await page.getByLabel("Choose images").setInputFiles({
    name: "wrong.png",
    mimeType: "image/jpeg",
    buffer: Buffer.from([1, 2, 3]),
  });
  await expect(
    page.getByRole("region", { name: "Tool workspace" }).getByRole("alert"),
  ).toContainText("filename and file type agree");
  await page.getByRole("button", { name: /Remove image 1/ }).click();
  await page.getByLabel("Choose images").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(
    page.getByRole("region", { name: "Tool workspace" }).getByRole("alert"),
  ).toContainText("does not contain the JPEG or PNG data");
});
