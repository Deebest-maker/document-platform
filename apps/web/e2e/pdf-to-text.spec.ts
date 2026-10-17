import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";

test.describe.configure({ timeout: 90_000 });

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );

async function choose(page: Page, name: string, displayName = "local.pdf") {
  await page.getByLabel("Choose PDF").setInputFiles({
    name: displayName,
    mimeType: "application/pdf",
    buffer: await readFile(fixture(name)),
  });
}

interface AuditedRequest {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}

function audit(context: BrowserContext, page: Page) {
  const requests: AuditedRequest[] = [];
  const consoleMessages: string[] = [];
  const webSocketUrls: string[] = [];
  context.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
      headers: request.headers(),
    }),
  );
  context.on("console", (event) =>
    consoleMessages.push(`${event.type()}: ${event.text()}`),
  );
  // Playwright exposes `websocket` on Page, not on BrowserContext. Attach
  // to the primary page BEFORE navigation and use the supported
  // `context.on("page", ...)` pattern to cover popups. A LOCAL text tool
  // must never open a WebSocket.
  page.on("websocket", (ws) => webSocketUrls.push(ws.url()));
  context.on("page", (nextPage) =>
    nextPage.on("websocket", (ws) => webSocketUrls.push(ws.url())),
  );
  return { requests, consoleMessages, webSocketUrls };
}

const canary = "PRIVATE-PDF-TO-TEXT-CANARY-7Qf3n";

test("FR-TXT-001/002/004: extracts text in source order and offers local Copy and TXT download", async ({
  page,
  context,
  baseURL,
}) => {
  const observed = audit(context, page);
  await page.goto("/pdf-to-text");
  await expect(
    page.locator(".tool-heading").getByText("Processed on your device", {
      exact: false,
    }),
  ).toBeVisible();
  await choose(page, "preview-features.pdf", `${canary}.pdf`);
  await expect(page.getByText("Extracted text ready")).toBeVisible({
    timeout: 30_000,
  });

  const previewText = (await page
    .locator(".pdf-text-preview")
    .innerText()) as string;
  expect(previewText).toContain("P1");
  expect(previewText).toContain("P2");
  expect(previewText).toContain("P3");
  expect(previewText).toContain("P4");
  // Page order: P1 appears before P2, etc.
  expect(previewText.indexOf("P1")).toBeLessThan(previewText.indexOf("P2"));
  expect(previewText.indexOf("P2")).toBeLessThan(previewText.indexOf("P3"));
  expect(previewText.indexOf("P3")).toBeLessThan(previewText.indexOf("P4"));

  // Download bytes exactly match the full extracted text.
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download TXT" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("extracted-text.txt");
  const downloaded = new TextDecoder("utf-8").decode(
    new Uint8Array(await readFile((await download.path())!)),
  );
  expect(downloaded.length).toBeGreaterThan(0);
  expect(downloaded).toContain("P1");
  expect(downloaded).toContain("P4");

  // CONTEXT-WIDE STRICT PRIVACY AUDIT — every request, every header, every
  // body, every console line, plus explicit WebSocket + IndexedDB.
  const base = new URL(baseURL ?? "http://127.0.0.1:3100");
  const forbidden = [canary, "P1", "P2", "P3", "P4"];
  for (const request of observed.requests) {
    const url = new URL(request.url);
    const sameOrigin = url.origin === base.origin;
    const schemeOk =
      sameOrigin ||
      request.url.startsWith("blob:") ||
      request.url.startsWith("data:") ||
      request.url.startsWith("about:");
    expect(schemeOk, `unexpected non-first-party request: ${request.url}`).toBe(
      true,
    );
    expect(
      ["GET", "HEAD"].includes(request.method),
      `unexpected non-GET request: ${request.method} ${request.url}`,
    ).toBe(true);
    if (sameOrigin) {
      expect(url.pathname).not.toMatch(/^\/(api|v1|ingest|collect|rpc)\//);
    }
    const fullUrl = `${url.pathname}?${url.search}`;
    const headerBlob = Object.entries(request.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    for (const needle of forbidden) {
      expect(fullUrl).not.toContain(needle);
      expect(request.body ?? "").not.toContain(needle);
      expect(headerBlob).not.toContain(needle);
    }
  }
  const consoleText = observed.consoleMessages.join("\n");
  for (const needle of forbidden) expect(consoleText).not.toContain(needle);

  // No WebSocket.
  expect(
    observed.webSocketUrls,
    `unexpected WebSocket connection(s): ${observed.webSocketUrls.join(", ")}`,
  ).toEqual([]);

  // Persistent browser storage: localStorage, sessionStorage, IndexedDB.
  const storage = await page.evaluate(async () => {
    const dbNames =
      typeof indexedDB.databases === "function"
        ? await indexedDB.databases().catch(() => [])
        : [];
    return {
      local: Object.keys(window.localStorage).length,
      session: Object.keys(window.sessionStorage).length,
      indexedDbNames: dbNames.map((entry) => entry.name).filter(Boolean),
    };
  });
  expect(storage.local).toBe(0);
  expect(storage.session).toBe(0);
  expect(
    storage.indexedDbNames,
    `unexpected IndexedDB databases: ${storage.indexedDbNames.join(", ")}`,
  ).toEqual([]);
});

test("FR-TXT-001: XSS payloads in extracted text render as literal text and are not interpreted as HTML", async ({
  page,
}) => {
  await page.goto("/pdf-to-text");
  await choose(page, "text-xss.pdf");
  await expect(page.getByText("Extracted text ready")).toBeVisible({
    timeout: 30_000,
  });
  const preview = page.locator(".pdf-text-preview");
  // The payload MUST appear verbatim inside the <pre> text node.
  await expect(preview).toContainText("<script>alert(1)</script>");
  await expect(preview).toContainText(
    '<img src="x" onerror="document.title=1">',
  );
  // No <script> element from the payload is executed into the DOM.
  const injectedScripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("script"))
      .map((script) => script.textContent ?? "")
      .filter((text) => text.includes("alert(1)")).length;
  });
  expect(injectedScripts).toBe(0);
  // The document title must not have changed via the onerror payload.
  await expect(page).toHaveTitle(/PDF to Text/);
});

test("FR-TXT-002: partial-text documents report affected pages and keep the valid text", async ({
  page,
}) => {
  await page.goto("/pdf-to-text");
  await choose(page, "text-partial.pdf");
  await expect(page.getByText("Extracted text ready")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(/Some pages contained no meaningful text/),
  ).toBeVisible();
  const preview = await page.locator(".pdf-text-preview").innerText();
  expect(preview).toContain("PartialPage1Marker");
  expect(preview).toContain("PartialPage3Marker");
});

test("FR-TXT-003: an image-only PDF triggers the honest no-text/OCR panel without server upload", async ({
  page,
  context,
  baseURL,
}) => {
  const observed = audit(context, page);
  await page.goto("/pdf-to-text");
  await choose(page, "text-scanned.pdf");
  await expect(page.getByText("No text layer was found")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/scanned or image-based/)).toBeVisible();
  await expect(page.getByText(/does not perform OCR/)).toBeVisible();
  // Copy and Download must not be offered for a no-text document.
  await expect(page.getByRole("button", { name: "Copy text" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download TXT" })).toHaveCount(
    0,
  );
  const base = new URL(baseURL ?? "http://127.0.0.1:3100");
  for (const request of observed.requests) {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).origin).toBe(base.origin);
  }
});

test("FR-GEN-009: cancellation during extraction returns to a reusable state", async ({
  page,
}) => {
  await page.goto("/pdf-to-text");
  await choose(page, "preview-features.pdf");
  const cancel = page.getByRole("button", { name: "Cancel" });
  await cancel.waitFor({ state: "visible" });
  await cancel.click();
  await expect(page.getByText("Extract text from a PDF")).toBeVisible({
    timeout: 20_000,
  });
});

test("Accessibility: keyboard reaches Copy, Download and Start over; no axe violations on the result state", async ({
  page,
}) => {
  await page.goto("/pdf-to-text");
  await choose(page, "preview-features.pdf");
  await expect(page.getByText("Extracted text ready")).toBeVisible({
    timeout: 30_000,
  });
  // Tab to the three result buttons in order.
  await page.getByLabel("Extracted text preview").focus({ timeout: 10_000 });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Copy text" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Download TXT" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Start over" })).toBeFocused();

  const builder = new AxeBuilder({ page })
    .include(".tool-shell")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  const results = await builder.analyze();
  expect(results.violations).toEqual([]);
});
