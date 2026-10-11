import { test, expect } from "./fixtures";

const routes = [
  "/",
  "/tools",
  "/merge-pdf",
  "/organize-pdf",
  "/extract-pdf-pages",
  "/delete-pdf-pages",
  "/rotate-pdf",
  "/split-pdf",
  "/jpg-to-pdf",
  "/pdf-to-jpg",
  "/about",
  "/privacy",
  "/terms",
  "/contact",
];

for (const route of routes) {
  test(`shell regression: ${route} renders with correct availability and requests`, async ({
    page,
    browserName,
  }, testInfo) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.locator('input[type="file"]')).toHaveCount(
      [
        "/merge-pdf",
        "/organize-pdf",
        "/extract-pdf-pages",
        "/delete-pdf-pages",
        "/rotate-pdf",
        "/split-pdf",
        "/jpg-to-pdf",
        "/pdf-to-jpg",
      ].includes(route)
        ? 1
        : 0,
    );
    await expect(page.locator("progress, [download]")).toHaveCount(0);

    if (
      [
        "/",
        "/tools",
        "/merge-pdf",
        "/organize-pdf",
        "/extract-pdf-pages",
        "/delete-pdf-pages",
        "/rotate-pdf",
        "/split-pdf",
        "/jpg-to-pdf",
        "/pdf-to-jpg",
      ].includes(route)
    ) {
      await page.screenshot({
        path: testInfo.outputPath(
          `${route === "/" ? "home" : route.slice(1)}.png`,
        ),
        fullPage: true,
      });
    }

    const skip = page.getByRole("link", { name: "Skip to content" });
    if (browserName === "webkit") {
      // Safari/macOS may omit links from plain-Tab traversal by user preference.
      await skip.focus();
    } else await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("unpublished tools return 404 rather than bulk placeholders", async ({
  request,
}) => {
  for (const route of ["/compress-pdf", "/word-to-pdf", "/not-a-tool"]) {
    const response = await request.get(route);
    expect(response.status()).toBe(404);
  }
});

test("trust navigation leads to clearly qualified pages", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("navigation", { name: "Trust and legal" });
  for (const name of ["About", "Privacy", "Terms", "Contact"]) {
    await footer.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("main")).toContainText(
      /preview|draft|placeholder/i,
    );
  }
});
