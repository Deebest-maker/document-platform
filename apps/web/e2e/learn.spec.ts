import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { learnArticles } from "../content/learn-articles";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("the Learn hub lists every guide, readable without interaction", async ({
  page,
}) => {
  const response = await page.goto("/learn");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const main = page.getByRole("main");
  for (const article of learnArticles) {
    const link = main.getByRole("link", { name: article.title, exact: true });
    await expect(link).toHaveAttribute("href", `/learn/${article.slug}`);
    await expect(
      main.getByText(article.summary, { exact: true }),
    ).toBeVisible();
  }

  const raw = await (await page.request.get("/learn")).text();
  expect(raw).toContain(learnArticles[0].slug);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(results.violations).toEqual([]);
});

for (const article of learnArticles) {
  test(`/learn/${article.slug} reads cleanly, links work and is accessible`, async ({
    page,
  }) => {
    const response = await page.goto(`/learn/${article.slug}`);
    expect(response?.status()).toBe(200);

    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole("heading", { level: 1, name: article.title, exact: true }),
    ).toBeVisible();
    for (const section of article.sections) {
      await expect(
        main.getByRole("heading", {
          level: 2,
          name: section.heading,
          exact: true,
        }),
      ).toBeVisible();
    }
    await expect(
      main.getByRole("navigation", { name: "In this guide" }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Tools in this guide" }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Keep reading" }),
    ).toBeVisible();

    // The contents list jumps to the section it names.
    const first = article.sections[0].heading;
    await main
      .getByRole("navigation", { name: "In this guide" })
      .getByRole("link", { name: first, exact: true })
      .click();
    await expect(page).toHaveURL(/#[a-z0-9-]+$/);

    // Reading the guide needs no script: it is in the server-rendered HTML.
    const raw = await (await page.request.get(`/learn/${article.slug}`)).text();
    expect(raw).toContain("<h1>");
    expect(raw).toContain(article.sections[1].heading.replace(/'/g, "&#x27;"));

    // Every internal link resolves, and none points at a planned tool.
    const hrefs = await main
      .locator("a[href]")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
      );
    const internal = [
      ...new Set(
        hrefs
          .filter((href) => href.startsWith("/"))
          .map((href) => href.split("#")[0]),
      ),
    ];
    expect(internal.length).toBeGreaterThan(2);
    for (const href of internal) {
      const linked = await page.request.get(href);
      expect(linked.status(), `${article.slug} -> ${href}`).toBe(200);
    }
    expect(internal).not.toContain("/pdf-to-word");

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(wcag).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("a visitor can go from the home page to a guide, to its tool and back", async ({
  page,
}) => {
  await page.goto("/");
  const featured = learnArticles.filter((article) => article.featured);
  const guides = page.getByRole("region", { name: "From the guides" });
  for (const article of featured) {
    await expect(
      guides.getByRole("link", { name: article.title, exact: true }),
    ).toBeVisible();
  }

  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Learn", exact: true })
    .click();
  await expect(page).toHaveURL(/\/learn$/);

  await page
    .getByRole("main")
    .getByRole("link", { name: learnArticles[0].title, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/learn/${learnArticles[0].slug}$`));

  await page
    .getByRole("complementary", { name: "Tools in this guide" })
    .getByRole("link", { name: "Merge PDF", exact: true })
    .click();
  await expect(page).toHaveURL(/\/merge-pdf$/);

  const learnMore = page.getByRole("region", { name: "Learn more" });
  await expect(learnMore).toBeVisible();
  await learnMore
    .getByRole("link", { name: learnArticles[0].title, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/learn/${learnArticles[0].slug}$`));
});

test("the privacy guide separates the one upload tool from the rest", async ({
  page,
}) => {
  await page.goto("/learn/what-processed-on-your-device-means");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("link", { name: "Word to PDF", exact: true }).first(),
  ).toHaveAttribute("href", "/word-to-pdf");
  await expect(
    main.getByRole("link", { name: "Privacy page" }),
  ).toHaveAttribute("href", "/privacy");
  await expect(main).toContainText("Secure server processing");
  await expect(main).toContainText("Processed on your device");
});
