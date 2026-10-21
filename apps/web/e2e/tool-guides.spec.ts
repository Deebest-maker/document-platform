import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

const tools: [string, string][] = [
  ["merge-pdf", "Merge PDF"],
  ["compress-pdf", "Compress PDF"],
  ["split-pdf", "Split PDF"],
  ["jpg-to-pdf", "Images to PDF"],
  ["pdf-to-jpg", "PDF to JPG"],
  ["word-to-pdf", "Word to PDF"],
  ["organize-pdf", "Organize PDF"],
  ["extract-pdf-pages", "Extract PDF Pages"],
  ["delete-pdf-pages", "Delete PDF Pages"],
  ["rotate-pdf", "Rotate PDF"],
  ["remove-pdf-metadata", "Remove PDF Metadata"],
  ["pdf-to-text", "PDF to Text"],
];

for (const [slug, title] of tools) {
  test(`/${slug} shows its guide, readable without interaction`, async ({
    page,
  }) => {
    const response = await page.goto(`/${slug}`);
    expect(response?.status()).toBe(200);

    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    for (const heading of [
      `About ${title}`,
      `How to use ${title}`,
      "Good to know",
      "Common questions",
      "Related tools",
    ]) {
      await expect(
        main.getByRole("heading", { level: 2, name: heading, exact: true }),
      ).toBeVisible();
    }

    // The steps are a real ordered list, and the questions are headings.
    await expect(
      main
        .getByRole("region", { name: `How to use ${title}` })
        .getByRole("listitem"),
    ).not.toHaveCount(0);
    await expect(
      main
        .getByRole("region", { name: "Common questions" })
        .getByRole("heading", {
          level: 3,
        }),
    ).not.toHaveCount(0);

    // Related tools remain a labelled side region, separate from the guide.
    await expect(
      page.getByRole("complementary", { name: "Related tools" }),
    ).toBeVisible();

    // Reading the guide needs no script: it is in the server-rendered HTML.
    const raw = await (await page.request.get(`/${slug}`)).text();
    expect(raw).toContain(`About ${title.replace("&", "&amp;")}`);
    expect(raw).toContain("Common questions");

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
