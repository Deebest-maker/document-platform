import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";

test.describe.configure({ timeout: 120_000 });

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument, PDFName } = pdfRequire("pdf-lib");

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );

interface SourceImage {
  readonly bytes: Uint8Array;
  readonly kind: "jpg" | "png";
}

// Images are generated in the browser (no binary fixtures, no new dependencies)
// and then placed in PDFs with pdf-lib in Node. The noise makes them
// photograph-like: not flat graphics, so they are eligible for recompression.
async function makeImage(
  page: Page,
  kind: "jpg" | "png",
  width: number,
  height: number,
  seed: number,
  alpha = false,
  quality = 0.95,
): Promise<SourceImage> {
  const base64 = await page.evaluate(
    async ({ kind, width, height, seed, alpha, quality }) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(width, height);
      let state = seed >>> 0 || 1;
      const next = () => {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state;
      };
      const noise = kind === "jpg" ? 48 : 4;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4;
          image.data[index] = ((x * 255) / width + (next() % noise)) & 255;
          image.data[index + 1] = ((y * 255) / height + (next() % noise)) & 255;
          image.data[index + 2] =
            (((x + y) * 255) / (width + height) + (next() % noise)) & 255;
          image.data[index + 3] = alpha ? Math.round((x * 255) / width) : 255;
        }
      context.putImageData(image, 0, 0);
      const blob = await canvas.convertToBlob(
        kind === "jpg"
          ? { type: "image/jpeg", quality }
          : { type: "image/png" },
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000)
        text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return btoa(text);
    },
    { kind, width, height, seed, alpha, quality },
  );
  return { bytes: new Uint8Array(Buffer.from(base64, "base64")), kind };
}

// One image per page, drawn 400 pt wide (about 5.6 in), so a 2400 px image
// is about 430 dpi.
async function buildPdf(images: readonly SourceImage[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const source of images) {
    const embedded =
      source.kind === "jpg"
        ? await document.embedJpg(source.bytes)
        : await document.embedPng(source.bytes);
    const page = document.addPage([612, 792]);
    const width = 400;
    page.drawImage(embedded, {
      x: 106,
      y: 200,
      width,
      height: (width * embedded.height) / embedded.width,
    });
  }
  return document.save();
}

interface PdfImage {
  readonly width: number;
  readonly height: number;
  readonly hasSMask: boolean;
}

async function imagesOf(bytes: Uint8Array): Promise<PdfImage[]> {
  const document = await PDFDocument.load(bytes);
  const found: PdfImage[] = [];
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    const dict = (object as { dict?: Map<unknown, unknown> }).dict as
      | { get(name: unknown): { asNumber?: () => number } | undefined }
      | undefined;
    if (!dict || dict.get(PDFName.of("Subtype")) !== PDFName.of("Image"))
      continue;
    found.push({
      width: dict.get(PDFName.of("Width"))!.asNumber!(),
      height: dict.get(PDFName.of("Height"))!.asNumber!(),
      hasSMask: dict.get(PDFName.of("SMask")) !== undefined,
    });
  }
  return found;
}

async function choose(page: Page, bytes: Uint8Array, name = "local.pdf") {
  await page.getByLabel("Choose a PDF to compress").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(
    page.getByRole("heading", { name: "Choose how much to compress" }),
  ).toBeVisible();
}

async function compress(
  page: Page,
  strength?: "Light" | "Balanced" | "Strong",
) {
  if (strength)
    await page.getByRole("radio", { name: new RegExp(strength) }).check();
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compressed PDF ready" }),
  ).toBeVisible({ timeout: 90_000 });
}

async function download(page: Page): Promise<Uint8Array> {
  const link = page.getByRole("link", { name: "Download compressed PDF" });
  await expect(link).toHaveAttribute("download", "compressed.pdf");
  expect(await link.getAttribute("href")).toMatch(/^blob:/);
  const pending = page.waitForEvent("download");
  await link.click();
  const saved = await pending;
  expect(saved.suggestedFilename()).toBe("compressed.pdf");
  return new Uint8Array(await readFile((await saved.path())!));
}

function observe(context: BrowserContext, page: Page) {
  const requests: Array<{ url: string; method: string; text: string }> = [];
  const consoleMessages: string[] = [];
  context.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      text: [
        request.url(),
        request.postData() ?? "",
        JSON.stringify(request.headers()),
      ].join("\n"),
    }),
  );
  page.on("console", (message) => consoleMessages.push(message.text()));
  return { requests, consoleMessages };
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/compress-pdf");
});

test("FR-CMP-001..004: compresses a photo PDF on the device and reports true sizes", async ({
  page,
  context,
  baseURL,
}) => {
  const { requests, consoleMessages } = observe(context, page);
  await expect(page.getByText("images only").first()).toBeVisible();
  await expect(page.getByText(/some PDFs cannot be reduced/)).toBeVisible();

  const photo = await makeImage(page, "jpg", 2400, 1800, 7);
  const input = await buildPdf([photo]);
  const canary = "SOURCE-FILENAME-CANARY-C7q";
  await choose(page, input, `${canary}.pdf`);

  // Balanced is the safe default and the quality trade-off is visible.
  await expect(page.getByRole("radio", { name: /Balanced/ })).toBeChecked();
  await expect(
    page.getByText("Recommended for email and screens"),
  ).toBeVisible();
  await compress(page);

  const output = await download(page);
  expect(output.length).toBeLessThan(input.length);
  expect(String.fromCharCode(...output.slice(0, 5))).toBe("%PDF-");

  const shown = await page.locator(".compress-saving").innerText();
  const percent = Number(/(\d+)% smaller/.exec(shown)?.[1]);
  expect(percent).toBe(
    Math.min(99, Math.round((1 - output.length / input.length) * 100)),
  );
  expect(percent).toBeGreaterThan(30);

  const before = await imagesOf(input);
  const after = await imagesOf(output);
  expect(before.map((image) => image.width)).toEqual([2400]);
  expect(after).toHaveLength(1);
  // 400 pt wide at 150 dpi is about 833 px.
  expect(after[0].width).toBeGreaterThan(700);
  expect(after[0].width).toBeLessThan(950);
  expect(after[0].height / after[0].width).toBeCloseTo(0.75, 1);
  expect((await PDFDocument.load(output)).getPageCount()).toBe(1);

  await expect(
    page.getByText("1 of 1 image resized or re-saved."),
  ).toBeVisible();
  await expect(
    page.getByText(/Fine detail|softer|medium JPEG quality/).first(),
  ).toBeVisible();

  // Nothing left the device: same-origin GETs only, no canary anywhere.
  const origin = new URL(baseURL!).origin;
  for (const request of requests) {
    if (request.url.startsWith("blob:") || request.url.startsWith("data:"))
      continue;
    expect(new URL(request.url).origin).toBe(origin);
    expect(request.method).toBe("GET");
    expect(request.text).not.toContain(canary);
  }
  expect(consoleMessages.join("\n")).not.toContain(canary);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});

test("a stronger setting gives a smaller file from the same PDF without choosing it again", async ({
  page,
}) => {
  const photo = await makeImage(page, "jpg", 2400, 1800, 11);
  const input = await buildPdf([photo]);
  await choose(page, input);
  await compress(page, "Balanced");
  const balanced = await download(page);

  await page.getByRole("button", { name: "Try a different strength" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose how much to compress" }),
  ).toBeVisible();
  await compress(page, "Strong");
  const strong = await download(page);

  expect(strong.length).toBeLessThan(balanced.length);
  const [image] = await imagesOf(strong);
  // 400 pt at 110 dpi is about 611 px.
  expect(image.width).toBeGreaterThan(500);
  expect(image.width).toBeLessThan(700);
});

test("images with transparency are kept unchanged and the result says so", async ({
  page,
}) => {
  const photo = await makeImage(page, "jpg", 2400, 1800, 3);
  const logo = await makeImage(page, "png", 1200, 900, 5, true);
  const input = await buildPdf([photo, logo]);
  await choose(page, input);
  await compress(page);
  const output = await download(page);

  const images = await imagesOf(output);
  const transparent = images.filter((image) => image.hasSMask);
  expect(transparent).toHaveLength(1);
  expect(transparent[0].width).toBe(1200);
  expect(transparent[0].height).toBe(900);
  expect(images.some((image) => !image.hasSMask && image.width < 1000)).toBe(
    true,
  );
  await expect(
    page.getByText(/kept unchanged to protect quality/),
  ).toBeVisible();
});

test("says so and creates no file when the PDF cannot be made smaller", async ({
  page,
}) => {
  // Already at low quality and low resolution: nothing worth changing.
  const small = await makeImage(page, "jpg", 96, 72, 9, false, 0.5);
  await choose(page, await buildPdf([small]));
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "This PDF could not be made smaller" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/no compressed file was created/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download compressed PDF" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Choose another PDF" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a PDF to compress" }),
  ).toBeVisible();
});

test("password-protected and damaged PDFs fail with clear messages", async ({
  page,
}) => {
  await choose(page, await readFile(fixture("encrypted.pdf")));
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "This PDF could not be compressed" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/password-protected/i).first()).toBeVisible();

  await page.getByLabel("Choose another PDF").setInputFiles({
    name: "damaged.pdf",
    mimeType: "application/pdf",
    buffer: await readFile(fixture("corrupt.pdf")),
  });
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Tool workspace" })
      .getByText(/could not be opened as a PDF/),
  ).toBeVisible({ timeout: 60_000 });
});

test("cancelling returns to the strength choice and publishes nothing", async ({
  page,
}) => {
  // Six 6-megapixel photos keep the engine busy long enough to cancel. The
  // JPEG quality is lowered because Firefox encodes this noise at about twice
  // the size Chromium does: at 0.95 the file passed the tool's own 50 MiB input
  // limit in Firefox and was refused before it could be cancelled.
  const photo = await makeImage(page, "jpg", 3000, 2000, 13, false, 0.7);
  const input = await buildPdf(Array.from({ length: 6 }, () => photo));
  expect(
    input.length,
    "test input must stay well under the 50 MiB limit",
  ).toBeLessThan(35 * 1024 * 1024);
  await choose(page, input);
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compressing your PDF" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose how much to compress" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download compressed PDF" }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("cancelled");
});

test("is accessible and does not overflow in every state", async ({ page }) => {
  const audit = async () =>
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  await audit();
  expect(await horizontalOverflow(page)).toBe(false);

  const photo = await makeImage(page, "jpg", 2000, 1500, 17);
  await choose(page, await buildPdf([photo]));
  await audit();
  expect(await horizontalOverflow(page)).toBe(false);

  await compress(page);
  await audit();
  expect(await horizontalOverflow(page)).toBe(false);
  await expect(
    page.getByRole("heading", { name: "Compressed PDF ready" }),
  ).toBeFocused();
});
