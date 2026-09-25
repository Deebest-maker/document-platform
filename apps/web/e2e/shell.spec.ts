import { test, expect } from "./fixtures";

const routes = [
  "/",
  "/tools",
  "/merge-pdf",
  "/about",
  "/privacy",
  "/terms",
  "/contact",
];

for (const route of routes) {
  test(`M1 shell: ${route} renders without processing controls or unexpected requests`, async ({
    page,
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
    await expect(
      page.locator('input[type="file"], progress, [download]'),
    ).toHaveCount(0);

    if (["/", "/tools", "/merge-pdf"].includes(route)) {
      await page.screenshot({
        path: testInfo.outputPath(
          `${route === "/" ? "home" : route.slice(1)}.png`,
        ),
        fullPage: true,
      });
    }

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
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
  page,
}) => {
  for (const route of ["/compress-pdf", "/word-to-pdf", "/not-a-tool"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(404);
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
