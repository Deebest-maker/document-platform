import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );
type AuditedWindow = Window & {
  urlAudit: { created: string[]; revoked: string[] };
};

test("FR-PRV-001/005: full LOCAL flow, errors and offline re-merge never send document data or log it", async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  const canary = "SYNTHETIC_DOCUMENT_CANARY_7b33d80a";
  const filename = "SYNTHETIC_PRIVATE_FILENAME_421be8d2.pdf";
  const source = Buffer.concat([
    await readFile(fixture("a.pdf")),
    Buffer.from(`\n%${canary}\n`),
  ]);
  const needles = [
    canary,
    filename,
    encodeURIComponent(filename),
    source.toString("base64"),
  ];
  let forbidden = 0,
    leakage = 0,
    workers = 0;
  const consoleMessages: string[] = [];
  const origin = new URL(baseURL!).origin;
  context.on("request", (request) => {
    const url = new URL(request.url());
    const localBlob = url.protocol === "blob:" && url.origin === origin;
    const allowedPath =
      [
        "/merge-pdf",
        "/organize-pdf",
        "/extract-pdf-pages",
        "/delete-pdf-pages",
        "/rotate-pdf",
        "/",
        "/tools",
        "/about",
        "/privacy",
        "/terms",
        "/contact",
        "/favicon.ico",
      ].includes(url.pathname) || url.pathname.startsWith("/_next/static/");
    if (
      (!localBlob && (url.origin !== origin || !allowedPath)) ||
      !["GET", "HEAD"].includes(request.method())
    )
      forbidden++;
    const payload =
      request.url() +
      JSON.stringify(request.headers()) +
      (request.postData() ?? "");
    if (
      needles.some((needle) => payload.includes(needle)) ||
      request.postDataBuffer()?.includes(Buffer.from("%PDF-"))
    )
      leakage++;
  });
  context.on("console", (event) =>
    consoleMessages.push(`${event.type()}: ${event.text()}`),
  );
  page.on("worker", () => workers++);
  page.on("websocket", () => forbidden++);
  await page.goto("/merge-pdf");
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: source,
  });
  await page.locator('input[type="file"]').setInputFiles(fixture("b.pdf"));
  await page
    .getByRole("button", { name: "Move file 2 earlier", exact: true })
    .click();
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Download merged PDF" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.locator("[download]").click();
  await download;
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  // Cached application/engine assets are sufficient; no processor is running.
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
  await page
    .locator('input[type="file"]')
    .setInputFiles([fixture("c.pdf"), fixture("d.pdf")]);
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  if (offlineBlobReadable) {
    await expect(page.locator("[download]")).toBeVisible();
  } else {
    expect(browserName).toBe("webkit");
    await expect(
      page.getByRole("region", { name: "Tool workspace" }).getByRole("alert"),
    ).toBeVisible();
    await expect(page.locator("[download]")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await context.setOffline(false);
  for (const name of ["encrypted.pdf", "corrupt.pdf"]) {
    await page
      .locator('input[type="file"]')
      .setInputFiles([fixture("c.pdf"), fixture(name)]);
    await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Tool workspace" }).getByRole("alert"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start over", exact: true }).click();
  }
  expect(workers).toBe(4);
  expect(
    forbidden,
    "Only allowlisted public assets and routes were requested",
  ).toBe(0);
  expect(
    leakage,
    "No synthetic document canary or filename in request data",
  ).toBe(0);
  const expectedOfflineDiagnostic =
    "error: Failed to load resource: WebKit encountered an internal error";
  if (!offlineBlobReadable) {
    expect(browserName).toBe("webkit");
    expect(consoleMessages).toContain(expectedOfflineDiagnostic);
  }
  expect(
    consoleMessages.filter(
      (message) =>
        !(
          !offlineBlobReadable &&
          browserName === "webkit" &&
          message === expectedOfflineDiagnostic
        ),
    ),
    "No unexpected browser or worker console messages during processing",
  ).toEqual([]);
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0 });
});

test("result URL replacement, reset and client navigation revoke every owned URL", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const audit = { created: [] as string[], revoked: [] as string[] };
    (window as unknown as AuditedWindow).urlAudit = audit;
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob && blob.type === "application/pdf")
        audit.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      if (audit.created.includes(url)) audit.revoked.push(url);
      revoke(url);
    };
  });
  await page.goto("/merge-pdf");
  await page
    .locator('input[type="file"]')
    .setInputFiles([fixture("a.pdf"), fixture("b.pdf")]);
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  await expect(page.locator("[download]")).toBeVisible();
  const first = await page.locator("[download]").getAttribute("href");
  await page.getByRole("button", { name: "Change files or order" }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as AuditedWindow).urlAudit.revoked,
    ),
  ).toEqual([first]);
  await page
    .getByRole("button", { name: "Move file 2 earlier", exact: true })
    .click();
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  await expect(page.locator("[download]")).toBeVisible();
  expect(await page.locator("[download]").getAttribute("href")).not.toBe(first);
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as AuditedWindow).urlAudit.revoked.length,
    ),
  ).toBe(2);
  await page
    .locator('input[type="file"]')
    .setInputFiles([fixture("c.pdf"), fixture("d.pdf")]);
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  await expect(page.locator("[download]")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Trust and legal" })
    .getByRole("link", { name: "About", exact: true })
    .click();
  await expect(page).toHaveURL("/about");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const audit = (window as unknown as AuditedWindow).urlAudit;
        return {
          created: audit.created.length,
          allRevoked:
            audit.revoked.length === audit.created.length &&
            audit.revoked.every((url, index) => url === audit.created[index]),
        };
      }),
    )
    .toEqual({ created: 3, allRevoked: true });
  await page.goBack();
  await expect(page.getByRole("button", { name: "Choose PDFs" })).toBeVisible();
  await expect(page.locator(".selected-file, [download]")).toHaveCount(0);
});

test("processing status is accessible; cancel abandons a pending engine load and allows retry", async ({
  page,
}) => {
  await page.goto("/merge-pdf");
  await page
    .locator('input[type="file"]')
    .setInputFiles([fixture("a.pdf"), fixture("b.pdf")]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/static/**", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Creating your merged PDF" }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Merge PDFs", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Cancel merge" }).click();
    await expect(
      page.getByRole("heading", { name: "Arrange your PDFs" }),
    ).toBeFocused();
  } finally {
    release();
  }
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  await expect(page.locator("[download]")).toBeVisible();
});
