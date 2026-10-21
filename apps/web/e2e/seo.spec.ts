import { test, expect } from "./fixtures";

// The e2e server is built without SITE_URL / SITE_INDEXING, so it must behave
// as a preview that search engines are told to leave alone (ADR-028).

test("robots.txt disallows everything and links no sitemap by default", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toMatch(/User-Agent: \*/i);
  expect(body).toMatch(/^Disallow: \/$/m);
  expect(body).not.toMatch(/^Allow:/im);
  expect(body).not.toMatch(/^Sitemap:/im);
});

test("sitemap.xml is valid and empty by default", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/xml/);
  const body = await response.text();
  expect(body).toContain("<urlset");
  expect(body).not.toContain("<loc>");
});

for (const route of ["/", "/tools", "/merge-pdf", "/privacy", "/robots.txt"]) {
  test(`${route} is sent with a noindex header`, async ({ request }) => {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  });
}

test("a missing page is a real 404 and also noindex", async ({ request }) => {
  const response = await request.get("/pdf-to-word");
  expect(response.status()).toBe(404);
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

test("pages carry no canonical link or Open Graph tags without a site address", async ({
  page,
}) => {
  for (const route of ["/", "/merge-pdf"]) {
    await page.goto(route);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  }
});
