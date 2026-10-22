import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// M7C (ADR-034): text that comes from a visitor's files is shown as text. The
// file name is the string tools most often show back. These names are what
// someone would try if a name were ever put into the page as HTML. The checks
// do not rely on the Content Security Policy catching it: they look at the
// page itself for anything the name turned into. (Extracted PDF text has its
// own test in pdf-to-text.spec.ts.) The full tool-by-input matrix, with
// corrupt, empty and mislabelled files, is M7D.

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../../../tests/fixtures/pdf",
);
const PDF = readFileSync(path.join(FIXTURES, "a.pdf"));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
// Only the file's name and type matter to this test; nothing is converted.
const DOCX = Buffer.alloc(256);
const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// No "/" in any of them: a name is cut at the last path separator before it is
// shown, so a payload with one would be shortened rather than tested.
const HOSTILE_STEMS = [
  `"><img src=x onerror=window.__pwned='img'>`,
  `<svg onload=window.__pwned='svg'>`,
  `'><b onmouseover=window.__pwned='b'>x`,
  `javascript:window.__pwned='js'`,
  `{{constructor.constructor('window.__pwned=1')()}}`,
];

interface Tool {
  route: string;
  // true: the tool puts the name on the page, so it must appear as written.
  // false: it never shows it; the checks prove it did not become markup.
  shows: boolean;
  extension: string;
  mimeType: string;
  buffer: Buffer;
}

const pdfTool = (route: string, shows = false): Tool => ({
  route,
  shows,
  extension: "pdf",
  mimeType: "application/pdf",
  buffer: PDF,
});

const TOOLS: Tool[] = [
  pdfTool("/merge-pdf", true),
  pdfTool("/split-pdf"),
  pdfTool("/compress-pdf"),
  pdfTool("/rotate-pdf"),
  pdfTool("/extract-pdf-pages"),
  pdfTool("/delete-pdf-pages"),
  pdfTool("/organize-pdf"),
  pdfTool("/pdf-to-jpg"),
  pdfTool("/pdf-to-text"),
  pdfTool("/remove-pdf-metadata"),
  {
    route: "/jpg-to-pdf",
    shows: true,
    extension: "png",
    mimeType: "image/png",
    buffer: PNG,
  },
  {
    route: "/word-to-pdf",
    shows: true,
    extension: "docx",
    mimeType: DOCX_TYPE,
    buffer: DOCX,
  },
];

// Wait until the tool has stopped changing, so the checks look at the page
// after it has had the chance to show the name.
async function settled(page: Page) {
  const main = page.getByRole("main");
  let previous = "";
  let steady = 0;
  for (let attempt = 0; attempt < 120 && steady < 3; attempt++) {
    const text = await main.innerText();
    const busy = /Opening (local|your) PDF|Working on your device/.test(text);
    steady = !busy && text === previous ? steady + 1 : 0;
    previous = text;
    await page.waitForTimeout(250);
  }
}

test.describe.configure({ timeout: 90_000 });

for (const tool of TOOLS) {
  test(`${tool.route} treats a hostile file name as plain text`, async ({
    page,
  }) => {
    for (const stem of HOSTILE_STEMS) {
      const name = `${stem}.${tool.extension}`;
      await page.goto(tool.route);
      await page.locator('input[type="file"]').first().setInputFiles({
        name,
        mimeType: tool.mimeType,
        buffer: tool.buffer,
      });
      if (tool.shows) {
        // The name is shown, exactly as it was written.
        await expect(page.getByRole("main")).toContainText(name, {
          timeout: 30_000,
        });
      }
      await settled(page);
      // ... and it did not become anything else.
      const state = await page.evaluate(() => ({
        ran: (window as unknown as { __pwned?: unknown }).__pwned,
        handlers: document.querySelectorAll(
          "[onerror], [onload], [onmouseover], [onclick]",
        ).length,
        injectedImages: document.querySelectorAll('img[src="x"]').length,
        injectedSvg: document.querySelectorAll("svg[onload]").length,
        injectedBold: document.querySelectorAll("b[onmouseover]").length,
      }));
      expect(state, `${tool.route} ${name}`).toEqual({
        ran: undefined,
        handlers: 0,
        injectedImages: 0,
        injectedSvg: 0,
        injectedBold: 0,
      });
    }
  });
}
