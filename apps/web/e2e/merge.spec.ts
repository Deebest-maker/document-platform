import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { inspectPages } from "../../../packages/pdf-browser/tests/helpers/pdf-assertions";

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );
// Paths are relative to this file: e2e -> web -> apps -> repository.
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("form and signature fixtures are accepted with truthful limitations", async ({
  page,
}, info) => {
  await page.goto("/merge-pdf");
  for (const [name, marker] of [
    ["form", "FORM1"],
    ["signed", "SIG1"],
  ]) {
    await page
      .locator('input[type="file"]')
      .setInputFiles([fixture(`${name}.pdf`), fixture("c.pdf")]);
    await expect(page.locator(".tool-workspace")).toContainText(
      "Digital signatures will not remain valid",
    );
    await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
    await expect(page.locator("[download]")).toBeVisible();
    const downloading = page.waitForEvent("download");
    await page.locator("[download]").click();
    const output = info.outputPath(`${name}-merged.pdf`);
    await (await downloading).saveAs(output);
    expect(
      (await inspectPages(new Uint8Array(await readFile(output)))).map(
        (item) => item.marker,
      ),
    ).toEqual([marker, "C1"]);
    await page.getByRole("button", { name: "Start over", exact: true }).click();
  }
});

test("FR-MRG-001/004: choose, keyboard reorder three PDFs, download exact order twice, reset", async ({
  page,
}, info) => {
  await page.goto("/merge-pdf");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose PDFs" }).focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles([fixture("a.pdf")]);
  await expect(
    page.getByRole("button", { name: "Merge PDFs", exact: true }),
  ).toBeDisabled();
  await page
    .locator('input[type="file"]')
    .setInputFiles([fixture("b.pdf"), fixture("c.pdf")]);
  await page
    .getByRole("button", { name: "Move file 3 earlier", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Move file 2 earlier", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Move file 1 earlier", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Move file 3 earlier", exact: true })
    .press("Enter");
  await expect(page.locator(".file-description strong")).toHaveText([
    "c.pdf",
    "b.pdf",
    "a.pdf",
  ]);
  expect(
    (await new AxeBuilder({ page }).withTags(tags).analyze()).violations,
  ).toEqual([]);
  // axe may move focus while inspecting the skip link; restore the reviewed state.
  await page
    .getByRole("button", { name: "Move file 2 earlier", exact: true })
    .focus();
  await page.screenshot({
    path: info.outputPath("merge-selected.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  const downloadLink = page.getByRole("link", { name: "Download merged PDF" });
  await expect(downloadLink).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your merged PDF is ready" }),
  ).toBeFocused();
  const url = await downloadLink.getAttribute("href");
  for (let repeat = 0; repeat < 2; repeat++) {
    const downloading = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("merged.pdf");
    const output = info.outputPath(`merged-${repeat}.pdf`);
    await download.saveAs(output);
    const pages = await inspectPages(new Uint8Array(await readFile(output)));
    expect(pages).toEqual([
      { marker: "C1", width: 440, height: 630, rotation: 0 },
      { marker: "B1", width: 420, height: 610, rotation: 90 },
      { marker: "B2", width: 430, height: 620, rotation: 180 },
      { marker: "A1", width: 400, height: 600, rotation: 0 },
      { marker: "A2", width: 600, height: 400, rotation: 0 },
    ]);
    await expect(downloadLink).toHaveAttribute("href", url!);
  }
  expect(
    (await new AxeBuilder({ page }).withTags(tags).analyze()).violations,
  ).toEqual([]);
  await downloadLink.focus();
  await page.screenshot({
    path: info.outputPath("merge-result.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bring your PDFs together" }),
  ).toBeFocused();
  await expect(page.locator(".selected-file")).toHaveCount(0);
  await expect(downloadLink).toHaveCount(0);
});

test("duplicates remain separate; remove/add and drop input work", async ({
  page,
}) => {
  await page.goto("/merge-pdf");
  await page
    .locator('input[type="file"]')
    .setInputFiles([fixture("c.pdf"), fixture("c.pdf")]);
  await expect(page.locator(".selected-file")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Remove file 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Move file 1 earlier", exact: true }),
  ).toBeFocused();
  const buffer = Array.from(await readFile(fixture("d.pdf")));
  await page.locator(".file-picker").evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(bytes)], "d.pdf", { type: "application/pdf" }),
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
    );
  }, buffer);
  await expect(page.locator(".file-description strong")).toHaveText([
    "c.pdf",
    "d.pdf",
  ]);
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Download merged PDF" }),
  ).toBeVisible();
});

for (const [name, message] of [
  ["encrypted.pdf", "Password-protected PDFs are not supported"],
  ["corrupt.pdf", "damaged or unsupported"],
  ["truncated.pdf", "damaged or unsupported"],
]) {
  test(`safe ${name} failure and recovery`, async ({ page }) => {
    await page.goto("/merge-pdf");
    await page
      .locator('input[type="file"]')
      .setInputFiles([fixture("a.pdf"), fixture(name)]);
    await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Check your selection" }),
    ).toBeFocused();
    await expect(
      page.getByRole("region", { name: "Tool workspace" }).getByRole("alert"),
    ).toContainText(message);
    await expect(page.locator("[download]")).toHaveCount(0);
    expect(
      (await new AxeBuilder({ page }).withTags(tags).analyze()).violations,
    ).toEqual([]);
    await page
      .getByRole("button", { name: "Remove file 2", exact: true })
      .click();
    await page.locator('input[type="file"]').setInputFiles(fixture("c.pdf"));
    await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Download merged PDF" }),
    ).toBeVisible();
  });
}

test("empty, wrong-type, spoofed PDFs and per-file cap produce safe errors", async ({
  page,
}) => {
  await page.goto("/merge-pdf");
  for (const item of [
    { name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) },
    {
      name: "wrong.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("synthetic"),
    },
    {
      name: "large.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    },
  ]) {
    await page.locator('input[type="file"]').setInputFiles(item);
    await expect(
      page.getByRole("region", { name: "Tool workspace" }).getByRole("alert"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Merge PDFs", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Start over", exact: true }).click();
  }
  await page.locator('input[type="file"]').setInputFiles([fixture("c.pdf")]);
  await page.locator('input[type="file"]').setInputFiles({
    name: "spoof.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a PDF"),
  });
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Tool workspace" }).getByRole("alert"),
  ).toContainText("not a supported PDF");
});

test("selected and result states reflow at 320px, 200% text and reduced motion", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/merge-pdf");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page
    .locator('input[type="file"]')
    .setInputFiles([fixture("a.pdf"), fixture("b.pdf")]);
  for (const state of ["selected", "result"]) {
    if (state === "result") {
      await page
        .getByRole("button", { name: "Merge PDFs", exact: true })
        .click();
      await expect(page.locator("[download]")).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`merge-reflow-${state}.png`),
      fullPage: true,
    });
  }
});
