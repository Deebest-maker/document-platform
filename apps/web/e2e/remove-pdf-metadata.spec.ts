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
  await page.getByLabel("Choose a PDF to clean").setInputFiles({
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
  // the listener to the primary page BEFORE navigation (so any WS the
  // first navigation opens is observed), and use the supported
  // `context.on("page", ...)` pattern to cover popups and new tabs.
  // A LOCAL tool must never open a WebSocket.
  page.on("websocket", (ws) => webSocketUrls.push(ws.url()));
  context.on("page", (nextPage) =>
    nextPage.on("websocket", (ws) => webSocketUrls.push(ws.url())),
  );
  return { requests, consoleMessages, webSocketUrls };
}

const titleCanary = "SECRET-TITLE-CANARY-9Hjk";
const authorCanary = "SECRET-AUTHOR-CANARY-2Fqz";
const customCanary = "ACME-INTERNAL-CANARY-X3b";
const xmpCanary = "XMP-CANARY-V7m";

test("FR-META-001/004/006: removes supported metadata and lets the owner download the cleaned PDF locally", async ({
  page,
  context,
  baseURL,
}) => {
  const { requests, consoleMessages, webSocketUrls } = audit(context, page);
  const sentinel =
    baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  const base = new URL(sentinel);
  await page.goto(new URL("/remove-pdf-metadata", sentinel).toString());

  // The not-secure-redaction disclosure is on the page from the very first
  // render; it must be present before the owner picks a file.
  await expect(page.getByText(/not.*secure redaction/i).first()).toBeVisible();

  // Pass a filename canary too — nothing derived from it may leave the browser.
  const filenameCanary = "SOURCE-FILENAME-CANARY-K8m";
  await choose(page, "metadata-rich.pdf", `${filenameCanary}.pdf`);

  await expect(
    page.getByRole("heading", { name: "Cleaned PDF ready" }),
  ).toBeVisible({
    timeout: 60_000,
  });

  // Content preservation: page count surfaced truthfully.
  await expect(page.getByText(/^Pages$/)).toBeVisible();

  // Download link is a local blob URL, not a server endpoint, with a fixed
  // output filename that does NOT derive from the source filename.
  const link = page.getByRole("link", { name: /download cleaned pdf/i });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^blob:/);
  expect(href ?? "").not.toContain(filenameCanary);
  const download = await link.getAttribute("download");
  expect(download).toBe("metadata-removed.pdf");

  // CONTEXT-WIDE STRICT PRIVACY AUDIT — this matches the M3B.3 pattern and is
  // intentionally stronger than "only inspect non-GET requests".
  //
  //  - Every single request must be GET or HEAD, and must stay same-origin,
  //    `blob:`, `data:` or `about:`.
  //  - No request's URL path, URL querystring or body may contain any
  //    canary, including the one we injected into the filename.
  //  - No request may hit `/api/` or `/v1/` or similar backend paths.
  //  - No WebSocket.
  //  - No console message may carry a canary.
  //  - Persistent browser storage (localStorage, sessionStorage) must stay
  //    empty for a LOCAL tool.
  const forbidden = [
    titleCanary,
    authorCanary,
    customCanary,
    xmpCanary,
    filenameCanary,
  ];
  for (const request of requests) {
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
    for (const canary of forbidden) {
      expect(fullUrl).not.toContain(canary);
      expect(request.body ?? "").not.toContain(canary);
      expect(headerBlob).not.toContain(canary);
    }
  }
  const consoleText = consoleMessages.join("\n");
  for (const canary of forbidden) expect(consoleText).not.toContain(canary);

  // Explicit WebSocket assertion — a LOCAL tool must never open one.
  expect(
    webSocketUrls,
    `unexpected WebSocket connection(s): ${webSocketUrls.join(", ")}`,
  ).toEqual([]);

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
  // No persisted document-derived IndexedDB. (First-party/platform
  // runtime stores — if a browser creates any — would show here; this
  // tool opens none of its own.)
  expect(
    storage.indexedDbNames,
    `unexpected IndexedDB databases: ${storage.indexedDbNames.join(", ")}`,
  ).toEqual([]);
});

test("FR-META-003: shows truthful before/after presence for every supported field", async ({
  page,
  baseURL,
}) => {
  const sentinel =
    baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  await page.goto(new URL("/remove-pdf-metadata", sentinel).toString());
  await choose(page, "metadata-rich.pdf");
  await expect(
    page.getByRole("heading", { name: "Cleaned PDF ready" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  // Before shows at least 1 standard entry and the XMP stream present;
  // after shows 0 standard entries and absent XMP.
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByText("Standard Info entries")).toBeVisible();
  await expect(table.getByText("Custom Info entries")).toBeVisible();
  await expect(table.getByText("XMP metadata stream")).toBeVisible();
  await expect(table.getByText("Trailer identifier")).toBeVisible();
});

test("NFR-UX-010: the not-secure-redaction disclosure is announced before upload", async ({
  page,
  baseURL,
}) => {
  const sentinel =
    baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  await page.goto(new URL("/remove-pdf-metadata", sentinel).toString());
  const note = page.getByRole("note").first();
  await expect(note).toBeVisible();
  await expect(note).toContainText(/not.*secure redaction/i);
  await expect(note).toContainText(/text and images.*preserved/i);
});

test("NFR-A11Y-001: the page has no serious or critical a11y issues at idle", async ({
  page,
  baseURL,
}) => {
  const sentinel =
    baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  await page.goto(new URL("/remove-pdf-metadata", sentinel).toString());
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

test("FR-META-005: encrypted PDFs are refused with the expected error copy", async ({
  page,
  baseURL,
}) => {
  const sentinel =
    baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  await page.goto(new URL("/remove-pdf-metadata", sentinel).toString());
  await choose(page, "encrypted.pdf");
  // Exclude Next.js' always-present route announcer, which is also role=alert.
  const alert = page.locator('[role="alert"]:not(#__next-route-announcer__)');
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText(/password-protected/i);
});
