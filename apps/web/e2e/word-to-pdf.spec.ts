import { test, expect } from "./fixtures";

/**
 * Word-to-PDF E2E tests.
 *
 * The processor backend is not running during E2E tests. All API calls
 * are intercepted via Playwright's route() to simulate the full
 * create → upload → convert → download → delete cycle.
 */

function mockProcessorApi(page: import("@playwright/test").Page) {
  const pdfBytes = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n" +
      "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
      "0000000058 00000 n \n0000000115 00000 n \n" +
      "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n",
  );

  // POST /api/processor/jobs — create
  page.route("**/api/processor/jobs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "e2e-job-id",
        token: "e2e-token",
        state: "created",
      }),
    });
  });

  // PUT /api/processor/jobs/{id}/input — upload
  page.route("**/api/processor/jobs/*/input", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });

  // POST /api/processor/jobs/{id}/convert — convert
  page.route("**/api/processor/jobs/*/convert", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "e2e-job-id",
        tool: "word-to-pdf",
        state: "succeeded",
        input_bytes: 1024,
        output_bytes: pdfBytes.length,
        error_code: null,
      }),
    });
  });

  // GET /api/processor/jobs/{id}/output — download
  page.route("**/api/processor/jobs/*/output", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: pdfBytes,
    });
  });

  // DELETE /api/processor/jobs/{id} — cleanup
  page.route("**/api/processor/jobs/e2e-job-id", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 204 });
  });
}

test("word-to-pdf page renders with correct structure", async ({ page }) => {
  await page.goto("/word-to-pdf");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Word to PDF",
  );
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.getByText("Secure server processing")).toBeVisible();
  await expect(page.locator("[download]")).toHaveCount(0);
});

test("word-to-pdf shows privacy disclosure before upload", async ({ page }) => {
  await page.goto("/word-to-pdf");
  // Scope to the first <details> — the tool's own privacy indicator,
  // not the related-tools disclosures further down the page.
  const details = page.locator("details").first();
  await expect(details).toBeVisible();
  await expect(details.locator("summary")).toContainText(
    "Secure server processing",
  );
  await details.locator("summary").click();
  await expect(details).toContainText("deleted automatically");
});

test("word-to-pdf rejects non-DOCX files client-side", async ({ page }) => {
  await page.goto("/word-to-pdf");

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(100),
  });

  // Scope to workspace region to avoid matching the visually-hidden
  // aria-live announcement that duplicates the error text.
  const workspace = page.getByRole("region", { name: "Tool workspace" });
  await expect(workspace.getByText("not a supported DOCX")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Convert to PDF" }),
  ).toBeDisabled();
});

// Tests that mock the processor API need allowProcessorRequests so the
// request-audit fixture doesn't flag the intercepted XHR/fetch calls.
test.describe("with mocked processor", () => {
  test.use({ allowProcessorRequests: true });

  test("full conversion flow", async ({ page }) => {
    await mockProcessorApi(page);
    await page.goto("/word-to-pdf");

    // Select a DOCX file
    const fileInput = page.locator('input[type="file"]');
    const minimalDocx = Buffer.alloc(256); // Fake DOCX bytes for E2E
    await fileInput.setInputFiles({
      name: "test-document.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: minimalDocx,
    });

    // Should show selected state — use exact match to avoid the
    // visually-hidden aria-live status ("test-document.docx selected.").
    await expect(
      page.getByText("test-document.docx", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Convert to PDF" }),
    ).toBeEnabled();

    // Click convert
    await page.getByRole("button", { name: "Convert to PDF" }).click();

    // Should show result — use heading role to avoid matching the
    // aria-live announcement.
    await expect(
      page.getByRole("heading", { name: "Your PDF is ready" }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("link", { name: "Download PDF" }),
    ).toBeVisible();
  });

  test("start over resets the session", async ({ page }) => {
    await mockProcessorApi(page);
    await page.goto("/word-to-pdf");

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "test.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.alloc(256),
    });

    await page.getByRole("button", { name: "Convert to PDF" }).click();
    await expect(
      page.getByRole("heading", { name: "Your PDF is ready" }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByText("Convert your Word document")).toBeVisible();
  });
});
