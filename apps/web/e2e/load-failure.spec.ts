import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// M7H (ADR-038). The connection drops after a page has loaded and before the
// first file is chosen, so the tool's own code cannot be fetched. The person
// did nothing wrong and neither did the file, so the words must name the
// connection and say to try again, never "try another PDF". Once the
// connection is back, the same page must work without a reload.

test.describe.configure({ timeout: 120_000 });

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
    ),
  );

const main = (page: Page) => page.getByRole("main");
const alerts = (page: Page) => main(page).locator('[role="alert"]');
const fileInput = (page: Page) => page.locator('input[type="file"]').first();

// Everything the page has not already fetched: lazily loaded chunks and the
// workers' scripts. The page itself, its first scripts and its styles are in.
const LAZY_CODE = /\/_next\/static\/.*\.js(\?.*)?$/;

async function cutTheConnection(page: Page) {
  await page.route(LAZY_CODE, (route) => route.abort("connectionfailed"));
}
async function restoreTheConnection(page: Page) {
  await page.unroute(LAZY_CODE);
}

// The other way a tool's code goes missing: the page and its chunks are in, but
// the script of a worker it starts later cannot be fetched. Every Worker the
// page creates is pointed at a script that does not exist, which is what a
// dropped connection looks like to the browser.
async function prepareWorkerCut(page: Page) {
  await page.addInitScript(() => {
    const Real = window.Worker;
    const flag = window as unknown as { __workersCut?: boolean };
    window.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(
          flag.__workersCut ? "/_next/static/missing-worker.js" : url,
          options,
        );
      }
    };
  });
}
async function cutWorkers(page: Page, cut: boolean) {
  await page.evaluate((value) => {
    (window as unknown as { __workersCut?: boolean }).__workersCut = value;
  }, cut);
}

/** The words the person is given, from the alert regions. */
async function said(page: Page): Promise<string> {
  await expect(alerts(page).first()).toBeVisible({ timeout: 30_000 });
  const texts = await alerts(page).evaluateAll((regions) =>
    regions.map((region) => region.textContent ?? ""),
  );
  return texts.join("\n");
}

// What a person who lost signal must hear, and what they must not.
const NAMES_THE_CONNECTION = /connection/i;
// The sentences these tools used before M7H. The "Choose another PDF" button
// that sits in the same alert has no full stop after it, so it does not match.
const BLAMES_THE_FILE =
  /(choose|try) another (pdf|file)\.|try again later|preview could not open|damaged|unsupported|not a supported|too large|memory/i;

interface Tool {
  route: string;
  /** Chooses a good file and, where the tool needs it, starts the work. */
  offer(page: Page): Promise<void>;
  /** Once the connection is back, the same page finishes the job. */
  recover(page: Page): Promise<void>;
}

const pageTool = (route: string): Tool => ({
  route,
  async offer(page) {
    await fileInput(page).setInputFiles({
      name: "good.pdf",
      mimeType: "application/pdf",
      buffer: fixture("preview-features.pdf"),
    });
  },
  async recover(page) {
    await fileInput(page).setInputFiles({
      name: "good.pdf",
      mimeType: "application/pdf",
      buffer: fixture("preview-features.pdf"),
    });
    await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
      timeout: 30_000,
    });
    await expect(alerts(page)).toHaveCount(0);
  },
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const TOOLS: Tool[] = [
  pageTool("/split-pdf"),
  pageTool("/rotate-pdf"),
  pageTool("/extract-pdf-pages"),
  pageTool("/delete-pdf-pages"),
  pageTool("/organize-pdf"),
  pageTool("/pdf-to-jpg"),
  {
    route: "/pdf-to-text",
    async offer(page) {
      await fileInput(page).setInputFiles({
        name: "good.pdf",
        mimeType: "application/pdf",
        buffer: fixture("text-partial.pdf"),
      });
    },
    async recover(page) {
      await page.getByRole("button", { name: "Choose another PDF" }).click();
      await fileInput(page).setInputFiles({
        name: "good.pdf",
        mimeType: "application/pdf",
        buffer: fixture("text-partial.pdf"),
      });
      await expect(
        page.getByRole("heading", {
          name: /Extracted text ready|No text layer was found/,
        }),
      ).toBeVisible({ timeout: 45_000 });
      await expect(alerts(page)).toHaveCount(0);
    },
  },
  {
    route: "/remove-pdf-metadata",
    async offer(page) {
      await fileInput(page).setInputFiles({
        name: "good.pdf",
        mimeType: "application/pdf",
        buffer: fixture("metadata-rich.pdf"),
      });
    },
    async recover(page) {
      if ((await page.locator('input[type="file"]').count()) === 0)
        await page
          .getByRole("button", { name: /choose another|start over/i })
          .first()
          .click();
      await fileInput(page).setInputFiles({
        name: "good.pdf",
        mimeType: "application/pdf",
        buffer: fixture("metadata-rich.pdf"),
      });
      await expect(
        page.getByRole("heading", { name: "Cleaned PDF ready" }),
      ).toBeVisible({ timeout: 45_000 });
      await expect(alerts(page)).toHaveCount(0);
    },
  },
  {
    route: "/merge-pdf",
    async offer(page) {
      await fileInput(page).setInputFiles([
        {
          name: "a.pdf",
          mimeType: "application/pdf",
          buffer: fixture("a.pdf"),
        },
        {
          name: "b.pdf",
          mimeType: "application/pdf",
          buffer: fixture("b.pdf"),
        },
      ]);
      await page
        .getByRole("button", { name: "Merge PDFs", exact: true })
        .click();
    },
    async recover(page) {
      await page
        .getByRole("button", { name: "Merge PDFs", exact: true })
        .click();
      await expect(
        page.getByRole("link", { name: /Download merged PDF/ }),
      ).toBeVisible({ timeout: 45_000 });
    },
  },
  {
    route: "/jpg-to-pdf",
    async offer(page) {
      await fileInput(page).setInputFiles({
        name: "dot.png",
        mimeType: "image/png",
        buffer: PNG,
      });
      await page.getByRole("button", { name: "Create PDF" }).click();
    },
    async recover(page) {
      await page.getByRole("button", { name: "Create PDF" }).click();
      await expect(
        page.getByRole("heading", { name: "Your image PDF is ready" }),
      ).toBeVisible({ timeout: 45_000 });
    },
  },
  {
    route: "/compress-pdf",
    async offer(page) {
      await fileInput(page).setInputFiles({
        name: "good.pdf",
        mimeType: "application/pdf",
        buffer: fixture("a.pdf"),
      });
      await page
        .getByRole("button", { name: "Compress PDF", exact: true })
        .click();
    },
    async recover(page) {
      await fileInput(page).setInputFiles({
        name: "good.pdf",
        mimeType: "application/pdf",
        buffer: fixture("a.pdf"),
      });
      await page
        .getByRole("button", { name: "Compress PDF", exact: true })
        .click();
      await expect(alerts(page)).toHaveCount(0, { timeout: 45_000 });
      await expect(
        page.getByRole("link", { name: /Download/ }).first(),
      ).toBeVisible({ timeout: 45_000 });
    },
  },
];

for (const tool of TOOLS) {
  test(`${tool.route}: a connection that dropped is not blamed on a good file`, async ({
    page,
  }) => {
    await page.goto(tool.route);
    await expect(fileInput(page)).toBeAttached();

    await cutTheConnection(page);
    await tool.offer(page);
    const words = await said(page);
    expect.soft(words, "names the connection").toMatch(NAMES_THE_CONNECTION);
    expect.soft(words, "does not blame the file").not.toMatch(BLAMES_THE_FILE);

    await restoreTheConnection(page);
    await tool.recover(page);
  });
}

// Tools that start a worker: the open or the work must end with the same words.
const WORKER_TOOLS = TOOLS.filter(
  (tool) => tool.route !== "/remove-pdf-metadata",
);

for (const tool of WORKER_TOOLS) {
  test(`${tool.route}: a worker that could not start is not blamed on a good file`, async ({
    page,
  }) => {
    await prepareWorkerCut(page);
    await page.goto(tool.route);
    await expect(fileInput(page)).toBeAttached();

    await cutWorkers(page, true);
    await tool.offer(page);
    const words = await said(page);
    expect.soft(words, "names the connection").toMatch(NAMES_THE_CONNECTION);
    expect.soft(words, "does not blame the file").not.toMatch(BLAMES_THE_FILE);

    await cutWorkers(page, false);
    await tool.recover(page);
  });
}

// The page opened the PDF fine; the worker that writes the new file is the one
// that cannot start.
test("/organize-pdf: the export worker cannot start", async ({ page }) => {
  await prepareWorkerCut(page);
  await page.goto("/organize-pdf");
  await fileInput(page).setInputFiles({
    name: "good.pdf",
    mimeType: "application/pdf",
    buffer: fixture("preview-features.pdf"),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
    timeout: 30_000,
  });
  await cutWorkers(page, true);
  await page.getByRole("button", { name: "Export organized PDF" }).click();
  const words = await said(page);
  expect.soft(words, "names the connection").toMatch(NAMES_THE_CONNECTION);
  expect.soft(words, "does not blame the file").not.toMatch(BLAMES_THE_FILE);
  await cutWorkers(page, false);
  await page.getByRole("button", { name: "Export organized PDF" }).click();
  await expect(page.getByRole("link", { name: /Download/ })).toBeVisible({
    timeout: 45_000,
  });
});

test("/split-pdf: the split worker cannot start", async ({ page }) => {
  await prepareWorkerCut(page);
  await page.goto("/split-pdf");
  await fileInput(page).setInputFiles({
    name: "good.pdf",
    mimeType: "application/pdf",
    buffer: fixture("preview-features.pdf"),
  });
  await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
    timeout: 30_000,
  });
  await page.getByLabel("Output 1 page ranges").fill("1-2");
  await cutWorkers(page, true);
  await page.getByRole("button", { name: "Generate split files" }).click();
  const words = await said(page);
  expect.soft(words, "names the connection").toMatch(NAMES_THE_CONNECTION);
  expect.soft(words, "does not blame the file").not.toMatch(BLAMES_THE_FILE);
  await cutWorkers(page, false);
  await page.getByRole("button", { name: "Generate split files" }).click();
  await expect(page.getByRole("link", { name: /Download/ })).toBeVisible({
    timeout: 45_000,
  });
});
