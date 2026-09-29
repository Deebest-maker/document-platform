import { expect, test } from "@playwright/test";
test("unrelated production routes never load PDF.js or fonts; test consumer is absent", async ({
  page,
  request,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  for (const route of ["/", "/tools", "/merge-pdf"]) await page.goto(route);
  expect(
    requests.filter((url) =>
      /pdfjs|Liberation|standard_fonts|bcmap/i.test(url),
    ),
  ).toEqual([]);
  expect((await request.get("/__m2b-foundation")).status()).toBe(404);
  expect((await request.get("/tests/page-foundation")).status()).toBe(404);
});
