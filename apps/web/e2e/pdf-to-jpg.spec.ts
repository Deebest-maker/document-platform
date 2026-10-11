import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { inspectZip } from "../../../packages/pdf-browser/tests/helpers/zip-assertions";
import { expect, test } from "./fixtures";

test.describe.configure({ timeout: 90_000 });

const pdfRequire = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument } = pdfRequire("pdf-lib");
let cancellationFixture: Promise<Uint8Array> | undefined;
function cancellationPdf() {
  cancellationFixture ??= (async () => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 50; page++) document.addPage([612, 792]);
    return document.save();
  })();
  return cancellationFixture;
}

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );

function jpegDimensions(bytes: Uint8Array) {
  expect([...bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
  expect([...bytes.slice(-2)]).toEqual([0xff, 0xd9]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if ([0xd8, 0xd9, 0x01].includes(marker)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3)
      return {
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    offset += 2 + length;
  }
  throw new Error("JPEG frame dimensions were not found");
}

async function choose(page: Page, name = "local-source.pdf") {
  await page.getByLabel("Choose PDF").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: await readFile(fixture("preview-features.pdf")),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
    timeout: 30_000,
  });
}

async function downloadBytes(page: Page, linkName: string, filename: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: linkName }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(filename);
  return new Uint8Array(await readFile((await download.path())!));
}

function audit(context: BrowserContext) {
  const requests: { url: string; method: string; body: string | null }[] = [];
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
  return { requests, consoleMessages };
}

test("FR-P2I-001/002/004: selected pages render sequentially in source order as a validated local ZIP", async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  const canary = "PRIVATE-PDF-TO-JPG-NAME";
  const observed = audit(context);
  await page.goto("/pdf-to-jpg");
  await expect(
    page.locator(".tool-heading").getByText("Processed on your device", {
      exact: true,
    }),
  ).toBeVisible();
  await choose(page, `${canary}.pdf`);
  await page.getByLabel("Selected pages").check();
  await page.getByLabel("Select source page 4 for JPG export").check();
  await page.getByLabel("Select source page 2 for JPG export").check();
  await expect(
    page.getByText(/2 pages will be converted at 150 DPI/),
  ).toBeVisible();
  if (browserName === "chromium")
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Create JPG images" }).click();
  await expect(
    page.getByRole("heading", { name: "Your JPG ZIP is ready" }),
  ).toBeVisible();
  const entries = inspectZip(
    await downloadBytes(page, "Download ZIP", "pdf-pages-jpg.zip"),
  );
  expect(Object.keys(entries)).toEqual(["page-002.jpg", "page-004.jpg"]);
  expect(jpegDimensions(entries["page-002.jpg"])).toEqual({
    width: 1042,
    height: 1354,
  });
  expect(jpegDimensions(entries["page-004.jpg"])).toEqual({
    width: 1167,
    height: 875,
  });

  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(
    observed.requests.every(
      ({ url, method, body }) =>
        new URL(url).origin === new URL(baseURL!).origin &&
        method === "GET" &&
        body === null,
    ),
  ).toBe(true);
  expect(JSON.stringify(observed)).not.toContain(canary);
  expect(observed.consoleMessages).toEqual([]);
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0 });
});

test("FR-P2I-003: one page downloads directly and honors the exact 96 DPI geometry", async ({
  page,
}) => {
  await page.goto("/pdf-to-jpg");
  await choose(page);
  await page.getByLabel("Selected pages").check();
  await page.getByLabel("Select source page 1 for JPG export").check();
  await page.getByLabel("96 DPI").check();
  await page.getByRole("button", { name: "Create JPG images" }).click();
  await expect(
    page.getByRole("heading", { name: "Your JPG is ready" }),
  ).toBeVisible();
  const bytes = await downloadBytes(page, "Download JPG", "page-001.jpg");
  expect(jpegDimensions(bytes)).toEqual({ width: 667, height: 867 });
});

test("generation cancellation is atomic and leaves the page selection reusable", async ({
  page,
}) => {
  await page.goto("/pdf-to-jpg");
  await page.getByLabel("Choose PDF").setInputFiles({
    name: "cancellation-boundary.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await cancellationPdf()),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(50, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const cancelButton = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Cancel generation",
      );
      if (!cancelButton) return;
      observer.disconnect();
      cancelButton.click();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "Create JPG images" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose pages and resolution" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".organize-error")).toContainText("cancelled", {
    timeout: 20_000,
  });
  await expect(page.locator("[download]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create JPG images" }),
  ).toBeEnabled();
});

test("PDF to JPG rejects unsupported sources without producing a download", async ({
  page,
}) => {
  await page.goto("/pdf-to-jpg");
  for (const name of ["encrypted.pdf", "corrupt.pdf"]) {
    await page.getByLabel(/Choose (another )?PDF/).setInputFiles(fixture(name));
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("[download]")).toHaveCount(0);
  }
});
