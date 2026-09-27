import { test, expect } from "./fixtures";
import {
  categories,
  getPrivacyPresentation,
  tools,
} from "@document-platform/tool-registry";

test("homepage search leads to available LOCAL Merge", async ({ page }) => {
  await page.goto("/");
  const discovery = page.getByRole("search", { name: "Find document tools" });
  await discovery
    .getByRole("searchbox", { name: "Find a tool" })
    .fill("  MERGE pdf ");
  const results = page.locator(".home-search");
  await expect(results.getByRole("status")).toContainText("1 tool found");
  await results.getByRole("link", { name: "Merge PDF", exact: true }).click();
  await expect(page).toHaveURL("/merge-pdf");
  await expect(page).toHaveTitle("Merge PDF | Document & File Platform");
  await expect(
    page.getByRole("heading", { name: "Bring your PDFs together" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose PDFs" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Merge PDFs", exact: true }),
  ).toBeDisabled();
  const privacyTarget = await page
    .locator(".tool-heading summary")
    .boundingBox();
  expect(privacyTarget).not.toBeNull();
  expect(privacyTarget!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("link", { name: "Split PDF", exact: true }).click();
  await expect(page).toHaveURL("/tools#split-pdf");
  await expect(page.locator("#split-pdf")).toBeInViewport();
});

test("catalog records and disclosures agree with the registry", async ({
  page,
}) => {
  await page.goto("/tools");
  await expect(page.locator(".tool-row")).toHaveCount(tools.length);
  for (const category of categories)
    await expect(
      page.getByRole("heading", { name: category.title, exact: true }),
    ).toBeVisible();
  for (const tool of tools) {
    const row = page.locator(`#${tool.slug}`);
    await expect(row.getByRole("heading", { level: 3 })).toHaveText(
      tool.title + (tool.availability !== "planned" ? " ↗" : ""),
    );
    await expect(row.locator("summary")).toHaveText(
      getPrivacyPresentation(tool.processingMode, tool.availability).label,
    );
    await expect(row).toContainText(tool.description);
    await expect(row.locator(".availability")).toHaveText(
      tool.availability === "available"
        ? "Available"
        : tool.availability === "preview"
          ? "Page preview"
          : "Planned",
    );
  }
});

test("search, category filtering, empty results and reset are usable", async ({
  page,
}) => {
  await page.goto("/tools");
  const search = page.getByRole("searchbox", { name: "Find a tool" });
  const category = page.getByLabel("Filter by category");
  await category.selectOption("convert");
  await expect(page.locator(".tool-row")).toHaveCount(4);
  await search.fill("DOCX");
  await expect(page.locator(".tool-row")).toHaveCount(2);
  await search.fill("nonexistent task");
  await expect(
    page.getByRole("heading", { name: "No tools match this search" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("0 tools found");
  await page.getByRole("button", { name: "Reset search" }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(category).toHaveValue("all");
  await expect(page.locator(".tool-row")).toHaveCount(13);
  await expect(page).toHaveURL("/tools");
});

test("NFR-A11Y-001/002: discovery and disclosure work with keyboard alone", async ({
  page,
}) => {
  await page.goto("/tools");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const search = page.getByRole("searchbox", { name: "Find a tool" });
  await expect(search).toBeFocused();
  expect(
    await search.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.type("merge");
  await expect(page.getByRole("status")).toContainText("1 tool found");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Filter by category")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Reset search" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(search).toBeFocused();
  await expect(page.locator(".tool-row")).toHaveCount(13);

  await page.goto("/merge-pdf");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const disclosure = page.locator(".tool-heading summary");
  await expect(disclosure).toBeFocused();
  const box = await disclosure.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(
    await disclosure.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tool-heading details")).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(".tool-heading details p")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator(".tool-heading details")).not.toHaveAttribute(
    "open",
  );
});
