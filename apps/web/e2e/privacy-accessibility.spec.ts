import AxeBuilder from "@axe-core/playwright";
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
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Separate journeys retain the normal timeout and make failures attributable.
for (const route of routes) {
  for (const expanded of [false, true]) {
    test(`NFR-A11Y-006: ${route} ${expanded ? "expanded" : "initial"} accessibility`, async ({
      page,
    }) => {
      await page.goto(route);
      if (expanded) {
        for (const summary of await page.locator("summary").all())
          await summary.click();
      }
      const results = await new AxeBuilder({ page }).withTags(tags).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

for (const query of ["word", "nonexistent task"]) {
  test(`accessible discovery results for "${query}"`, async ({ page }) => {
    await page.goto("/tools");
    await page.getByRole("searchbox", { name: "Find a tool" }).fill(query);
    const results = await new AxeBuilder({ page }).withTags(tags).analyze();
    expect(results.violations).toEqual([]);
  });
}

for (const route of ["/", "/tools", "/merge-pdf"]) {
  test(`NFR-A11Y-005 / UX-010: ${route} reflows with enlarged text and reduced motion`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(route);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(
        `reflow-${route === "/" ? "home" : route.slice(1)}.png`,
      ),
      fullPage: true,
    });
    if (route === "/tools") {
      await page.getByRole("searchbox", { name: "Find a tool" }).fill("merge");
      await expect(page.getByRole("status")).toContainText("1 tool found");
    }
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
  });
}
