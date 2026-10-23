import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

// M7D (ADR-035): the bad-input matrix. Every tool is given every kind of file
// it should refuse, in the browser, the way a person would: a file chosen in
// the file picker. For each, the contract is the same:
//
//   1. the person is told, in an alert, what is wrong with the file;
//   2. the words name the real cause (an empty file is not "over the limit");
//   3. nothing is offered for download;
//   4. nothing leaves the browser and nothing throws (the audited `test`);
//   5. a good file chosen next works, without reloading the page.
//
// Findings are collected with soft assertions so one run lists every class a
// tool gets wrong instead of stopping at the first.

test.describe.configure({ timeout: 240_000 });

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );
const read = (name: string) => readFileSync(fixture(name));

interface Upload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const PDF = "application/pdf";
const GOOD = read("a.pdf");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
// A PDF with a catalogue and an empty page tree: well formed, and no pages.
const NO_PAGES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n" +
    "xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n" +
    "trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF\n",
);

// What each refusal has to say. The wording differs a little by tool; what
// must hold everywhere is the cause it names.
const EMPTY = /empty/i;
const NOT_A_PDF = /not a supported PDF/i;
const UNUSABLE =
  /damaged|unsupported|not a supported PDF|could not be (opened|cleaned|compressed|removed|created|extracted)/i;
const PASSWORD = /password/i;
const TOO_BIG = /limit|exceeds|too large/i;

type Cause = "empty" | "name-or-type" | "unusable" | "password" | "too-big";

const SAYS: Record<Cause, RegExp> = {
  empty: EMPTY,
  "name-or-type": NOT_A_PDF,
  unusable: UNUSABLE,
  password: PASSWORD,
  "too-big": TOO_BIG,
};

// Wording a refusal must never use for this cause.
const NEVER: Record<Cause, RegExp | undefined> = {
  empty: TOO_BIG,
  "name-or-type": TOO_BIG,
  unusable: /limit|exceeds|\bempty\b/i,
  password: undefined,
  "too-big": EMPTY,
};

interface BadPdf {
  label: string;
  cause: Cause;
  upload: Upload;
}

const BAD_PDFS: BadPdf[] = [
  {
    label: "a zero-byte file",
    cause: "empty",
    upload: { name: "empty.pdf", mimeType: PDF, buffer: Buffer.alloc(0) },
  },
  {
    label: "plain text named .pdf",
    cause: "unusable",
    upload: {
      name: "notes.pdf",
      mimeType: PDF,
      buffer: Buffer.from("this is not a PDF"),
    },
  },
  {
    label: "a web page with a script, named .pdf",
    cause: "unusable",
    upload: {
      name: "page.pdf",
      mimeType: PDF,
      buffer: Buffer.from("<script>alert(1)</script>"),
    },
  },
  {
    label: "a PNG image named .pdf",
    cause: "unusable",
    upload: { name: "picture.pdf", mimeType: PDF, buffer: PNG },
  },
  {
    label: "a PDF header and nothing else",
    cause: "unusable",
    upload: {
      name: "header.pdf",
      mimeType: PDF,
      buffer: Buffer.from("%PDF-1.7\n%%EOF\n"),
    },
  },
  {
    label: "a truncated PDF",
    cause: "unusable",
    upload: { name: "cut.pdf", mimeType: PDF, buffer: read("truncated.pdf") },
  },
  {
    label: "a corrupt PDF",
    cause: "unusable",
    upload: { name: "bad.pdf", mimeType: PDF, buffer: read("corrupt.pdf") },
  },
  {
    label: "a PDF with no pages",
    cause: "unusable",
    upload: { name: "nopages.pdf", mimeType: PDF, buffer: NO_PAGES },
  },
  {
    label: "a password-protected PDF",
    cause: "password",
    upload: {
      name: "locked.pdf",
      mimeType: PDF,
      buffer: read("encrypted.pdf"),
    },
  },
  {
    label: "a real PDF named .txt",
    cause: "name-or-type",
    upload: { name: "a.txt", mimeType: "text/plain", buffer: GOOD },
  },
  {
    label: "a real PDF with no extension",
    cause: "name-or-type",
    upload: { name: "report", mimeType: PDF, buffer: GOOD },
  },
  {
    label: "a real PDF named .pdf.exe",
    cause: "name-or-type",
    upload: { name: "report.pdf.exe", mimeType: PDF, buffer: GOOD },
  },
  {
    label: "a real PDF declared as an image",
    cause: "name-or-type",
    upload: { name: "a.pdf", mimeType: "image/png", buffer: GOOD },
  },
];

const main = (page: Page) => page.getByRole("main");
const alerts = (page: Page) => main(page).locator('[role="alert"]');
const fileInput = (page: Page) => page.locator('input[type="file"]').first();
const downloads = (page: Page) =>
  main(page).locator("a[download], button:has-text('Download')");

/** Chooses a file the size of `size` without sending its bytes from the test. */
async function chooseBigFile(page: Page, name: string, size: number) {
  await fileInput(page).evaluate(
    (input: HTMLInputElement, spec) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(spec.size)], spec.name, {
          type: "application/pdf",
        }),
      );
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { name, size },
  );
}

interface PdfTool {
  route: string;
  /** The size above which the tool refuses a PDF as too large. */
  limit: number;
  /** Gives the tool the file and returns what it said once it has decided. */
  offer(
    page: Page,
    upload: Upload | { bigName: string; size: number },
  ): Promise<string>;
  /** After refusals, a good file must work. */
  recover(page: Page): Promise<void>;
}

const MIB = 1024 * 1024;

async function refusalText(page: Page): Promise<string> {
  await expect(alerts(page).first()).toBeVisible({ timeout: 45_000 });
  // Some tools wrap their whole workspace in the alert, with the message
  // inside it. Read the message, not the page's fixed text around it.
  const texts = await alerts(page).evaluateAll((regions) =>
    regions.flatMap((region) => {
      const inner = region.querySelectorAll(
        ".merge-error, .organize-error, [role='alert']",
      );
      return inner.length
        ? Array.from(inner, (node) => node.textContent ?? "")
        : [region.textContent ?? ""];
    }),
  );
  return texts.join("\n");
}

async function choose(
  page: Page,
  what: Upload | { bigName: string; size: number },
  more: Upload[] = [],
) {
  if ("bigName" in what) await chooseBigFile(page, what.bigName, what.size);
  else await fileInput(page).setInputFiles([what, ...more]);
}

// The six tools that open the PDF as soon as it is chosen and show its pages.
const pageTool = (route: string): PdfTool => ({
  route,
  limit: 10 * MIB,
  async offer(page, what) {
    await choose(page, what);
    return refusalText(page);
  },
  async recover(page) {
    await fileInput(page).setInputFiles({
      name: "ok.pdf",
      // A browser that reports no type at all must still be accepted.
      mimeType: "",
      buffer: read("preview-features.pdf"),
    });
    await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
      timeout: 30_000,
    });
    await expect(alerts(page)).toHaveCount(0);
  },
});

const TOOLS: PdfTool[] = [
  pageTool("/split-pdf"),
  pageTool("/rotate-pdf"),
  pageTool("/extract-pdf-pages"),
  pageTool("/delete-pdf-pages"),
  pageTool("/organize-pdf"),
  pageTool("/pdf-to-jpg"),
  {
    route: "/pdf-to-text",
    limit: 10 * MIB,
    async offer(page, what) {
      await choose(page, what);
      return refusalText(page);
    },
    async recover(page) {
      // The error panel replaces the picker; its button brings it back.
      await page.getByRole("button", { name: "Choose another PDF" }).click();
      await fileInput(page).setInputFiles({
        name: "ok.pdf",
        mimeType: "",
        buffer: read("text-partial.pdf"),
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
    limit: 10 * MIB,
    async offer(page, what) {
      await choose(page, what);
      return refusalText(page);
    },
    async recover(page) {
      if ((await page.locator('input[type="file"]').count()) === 0)
        await page
          .getByRole("button", { name: /choose another|start over/i })
          .first()
          .click();
      await fileInput(page).setInputFiles({
        name: "ok.pdf",
        mimeType: "",
        buffer: read("metadata-rich.pdf"),
      });
      await expect(
        page.getByRole("heading", { name: "Cleaned PDF ready" }),
      ).toBeVisible({ timeout: 45_000 });
      await expect(alerts(page)).toHaveCount(0);
    },
  },
  {
    route: "/compress-pdf",
    limit: 50 * MIB,
    async offer(page, what) {
      await choose(page, what);
      // Size, name and type are refused when the file is chosen; what is inside
      // it is refused when compression starts.
      const start = page.getByRole("button", {
        name: "Compress PDF",
        exact: true,
      });
      await expect(start.or(alerts(page).first())).toBeVisible({
        timeout: 45_000,
      });
      if (await start.isVisible()) await start.click();
      return refusalText(page);
    },
    async recover(page) {
      await fileInput(page).setInputFiles({
        name: "ok.pdf",
        mimeType: "",
        buffer: GOOD,
      });
      await expect(
        page.getByRole("button", { name: "Compress PDF", exact: true }),
      ).toBeVisible();
      await expect(alerts(page)).toHaveCount(0);
    },
  },
  {
    route: "/merge-pdf",
    limit: 10 * MIB,
    async offer(page, what) {
      // Merge needs two files; the second is good and is not what is refused.
      const good = { name: "ok.pdf", mimeType: PDF, buffer: GOOD };
      if ("bigName" in what) {
        await chooseBigFile(page, what.bigName, what.size);
        await fileInput(page).setInputFiles(good);
      } else await fileInput(page).setInputFiles([what, good]);
      await expect(page.locator(".selected-file")).toHaveCount(2);
      // Name, type and size are refused in the list; the contents when merging.
      if ((await alerts(page).count()) === 0)
        await page
          .getByRole("button", { name: "Merge PDFs", exact: true })
          .click();
      return refusalText(page);
    },
    async recover(page) {
      // The bad file is the first row; remove it, then merge what is left.
      await page
        .getByRole("button", { name: "Remove file 1", exact: true })
        .click();
      await fileInput(page).setInputFiles({
        name: "ok2.pdf",
        mimeType: "",
        buffer: read("b.pdf"),
      });
      await expect(alerts(page)).toHaveCount(0);
      const merge = page.getByRole("button", {
        name: "Merge PDFs",
        exact: true,
      });
      await expect(merge).toBeEnabled();
      await merge.click();
      await expect(
        page.getByRole("link", { name: "Download merged PDF" }),
      ).toBeVisible({ timeout: 45_000 });
    },
  },
];

for (const tool of TOOLS) {
  test(`${tool.route} refuses every bad PDF for the right reason and recovers`, async ({
    page,
  }) => {
    for (const bad of BAD_PDFS) {
      await test.step(bad.label, async () => {
        await page.goto(tool.route);
        const said = await tool.offer(page, bad.upload);
        expect
          .soft(said, `${bad.label}: what it said`)
          .toMatch(SAYS[bad.cause]);
        const never = NEVER[bad.cause];
        if (never)
          expect
            .soft(said, `${bad.label}: wording it must not use`)
            .not.toMatch(never);
        expect
          .soft(await downloads(page).count(), `${bad.label}: download`)
          .toBe(0);
      });
    }

    await test.step("a file over the size limit", async () => {
      await page.goto(tool.route);
      const said = await tool.offer(page, {
        bigName: "huge.pdf",
        size: tool.limit + 1,
      });
      expect.soft(said, "what it said").toMatch(TOO_BIG);
      expect.soft(said, "wording it must not use").not.toMatch(EMPTY);
      expect.soft(await downloads(page).count(), "download").toBe(0);
    });

    // The last refusal is still on screen: a good file must still work.
    await test.step("a good file after the refusals", async () => {
      await tool.recover(page);
    });
  });
}

// ── Images to PDF ───────────────────────────────────────────────────────

const JPEG_START = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
]);

const BAD_IMAGES: { label: string; says: RegExp; upload: Upload }[] = [
  {
    label: "a zero-byte image",
    says: EMPTY,
    upload: {
      name: "empty.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(0),
    },
  },
  {
    label: "text named .jpg",
    says: /does not contain the JPEG or PNG data/i,
    upload: {
      name: "notes.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("hello"),
    },
  },
  {
    label: "a PDF named .jpg",
    says: /does not contain the JPEG or PNG data/i,
    upload: { name: "doc.jpg", mimeType: "image/jpeg", buffer: GOOD },
  },
  {
    label: "a vector image with a script, named .png",
    says: /does not contain the JPEG or PNG data/i,
    upload: {
      name: "vector.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      ),
    },
  },
  {
    label: "a JPEG header and nothing else",
    says: /damaged or cannot be decoded|preview could not be created/i,
    upload: { name: "cut.jpg", mimeType: "image/jpeg", buffer: JPEG_START },
  },
  {
    label: "a truncated PNG",
    says: /damaged or cannot be decoded|preview could not be created/i,
    upload: {
      name: "cut.png",
      mimeType: "image/png",
      buffer: PNG.subarray(0, 40),
    },
  },
  {
    label: "a GIF",
    says: /filename and file type agree/i,
    upload: {
      name: "anim.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"),
    },
  },
  {
    label: "a PNG named .jpg",
    says: /does not contain the JPEG or PNG data/i,
    upload: { name: "really-png.jpg", mimeType: "image/jpeg", buffer: PNG },
  },
  {
    label: "an image with no extension",
    says: /filename and file type agree/i,
    upload: { name: "photo", mimeType: "image/png", buffer: PNG },
  },
];

test("/jpg-to-pdf refuses every bad image for the right reason and recovers", async ({
  page,
}) => {
  for (const bad of BAD_IMAGES) {
    await test.step(bad.label, async () => {
      await page.goto("/jpg-to-pdf");
      await fileInput(page).setInputFiles(bad.upload);
      const said = await refusalText(page);
      expect.soft(said, `${bad.label}: what it said`).toMatch(bad.says);
      expect
        .soft(said, `${bad.label}: wording it must not use`)
        .not.toMatch(/size limit|exceeds/i);
      expect
        .soft(await downloads(page).count(), `${bad.label}: download`)
        .toBe(0);
    });
  }
  await test.step("a good image after the refusals", async () => {
    // A refused image stays in the list, marked, until it is removed.
    await page.getByRole("button", { name: /Remove image 1/ }).click();
    await fileInput(page).setInputFiles({
      name: "ok.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(main(page).getByText("ok.png").first()).toBeVisible();
    await expect(alerts(page)).toHaveCount(0);
  });
});

// ── Word to PDF ─────────────────────────────────────────────────────────

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const wordInput = (page: Page) => page.locator('input[type="file"]');
const convertButton = (page: Page) =>
  page.getByRole("button", { name: "Convert to PDF" });

test.describe("Word to PDF", () => {
  test.use({ allowProcessorRequests: true });

  const PDF_OUT = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n" +
      "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
      "0000000058 00000 n \n0000000115 00000 n \n" +
      "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n",
  );

  interface Step {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  }
  interface Script {
    create?: Step;
    upload?: Step | "network-failure";
    convert?: Step;
  }

  const refusal = (status: number, code: string): Step => ({
    status,
    body: { detail: { code, message: "ignored by the page" } },
  });

  /** A processor that answers as scripted and records what it was asked. */
  async function mockProcessor(page: Page, script: Script) {
    const seen: string[] = [];
    const reply = (route: Route, step: Step) =>
      route.fulfill({
        status: step.status,
        contentType: "application/json",
        headers: step.headers,
        body: JSON.stringify(step.body),
      });
    await page.route("**/api/processor/jobs**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(
        /^.*\/api\/processor/,
        "",
      );
      seen.push(
        `${request.method()} ${path.replace(/\/[\w-]{6,}\//, "/<id>/")}`,
      );
      if (request.method() === "POST" && path === "/jobs")
        return reply(
          route,
          script.create ?? {
            status: 201,
            body: { id: "job-1", token: "token-1", state: "created" },
          },
        );
      if (request.method() === "PUT" && path.endsWith("/input")) {
        if (script.upload === "network-failure") return route.abort();
        return reply(
          route,
          script.upload ?? { status: 200, body: { status: "ok" } },
        );
      }
      if (request.method() === "POST" && path.endsWith("/convert"))
        return reply(
          route,
          script.convert ?? {
            status: 200,
            body: {
              id: "job-1",
              tool: "word-to-pdf",
              state: "succeeded",
              input_bytes: 100,
              output_bytes: PDF_OUT.length,
              error_code: null,
            },
          },
        );
      if (request.method() === "GET" && path.endsWith("/output"))
        return route.fulfill({
          status: 200,
          contentType: "application/pdf",
          body: PDF_OUT,
        });
      if (request.method() === "DELETE") return route.fulfill({ status: 204 });
      return route.fallback();
    });
    return seen;
  }

  const docx = (name = "report.docx"): Upload => ({
    name,
    mimeType: DOCX,
    buffer: Buffer.alloc(256, 1),
  });

  test("refuses what is not a .docx before anything is sent", async ({
    page,
  }) => {
    const seen = await mockProcessor(page, {});
    const cases: { label: string; says: RegExp; upload: Upload }[] = [
      {
        label: "a zero-byte .docx",
        says: EMPTY,
        upload: { name: "empty.docx", mimeType: DOCX, buffer: Buffer.alloc(0) },
      },
      {
        label: "an older .doc file",
        says: /not a supported DOCX/i,
        upload: {
          name: "old.doc",
          mimeType: "application/msword",
          buffer: Buffer.alloc(256, 1),
        },
      },
      {
        label: "a PDF",
        says: /not a supported DOCX/i,
        upload: { name: "a.pdf", mimeType: PDF, buffer: GOOD },
      },
      {
        label: "a file with no extension",
        says: /not a supported DOCX/i,
        upload: {
          name: "report",
          mimeType: DOCX,
          buffer: Buffer.alloc(256, 1),
        },
      },
      {
        label: "a .docx.exe",
        says: /not a supported DOCX/i,
        upload: docx("report.docx.exe"),
      },
    ];
    for (const bad of cases) {
      await test.step(bad.label, async () => {
        await page.goto("/word-to-pdf");
        await wordInput(page).setInputFiles(bad.upload);
        const said = await refusalText(page);
        expect.soft(said, `${bad.label}: what it said`).toMatch(bad.says);
        expect.soft(said).not.toMatch(TOO_BIG);
        await expect.soft(convertButton(page)).toBeDisabled();
      });
    }
    await test.step("a .docx over the size limit", async () => {
      await page.goto("/word-to-pdf");
      await wordInput(page).evaluate((input: HTMLInputElement) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(21 * 1024 * 1024)], "huge.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        );
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect.soft(await refusalText(page)).toMatch(/size limit/i);
      await expect.soft(convertButton(page)).toBeDisabled();
    });
    expect(seen, "nothing was sent for a file refused on this device").toEqual(
      [],
    );
  });

  // What the server says about a document it will not or cannot convert, and
  // what the page tells the person. The server's answers are scripted; the
  // real server's side is covered by the processor tests.
  const VERDICTS: {
    label: string;
    script: Script;
    says: RegExp;
    never?: RegExp;
    cleansUp: boolean;
  }[] = [
    {
      label: "a document the server will not accept (400 invalid_input)",
      script: { convert: refusal(400, "invalid_input") },
      says: /could not be accepted.*password-protected.*\.doc/i,
      never: /not available|try again in a moment/i,
      cleansUp: true,
    },
    {
      label: "a document the converter cannot read (422 conversion_failed)",
      script: { convert: refusal(422, "conversion_failed") },
      says: /could not finish.*damaged/i,
      // The failure that used to read "the server is not available".
      never: /not available|try again in a moment/i,
      cleansUp: true,
    },
    {
      label: "a document that is too big for the server (413)",
      script: { convert: refusal(413, "limit_exceeded") },
      says: /size limit/i,
      cleansUp: true,
    },
    {
      label: "a refused upload (413)",
      script: { upload: refusal(413, "limit_exceeded") },
      says: /size limit/i,
      cleansUp: true,
    },
    {
      label: "an upload that never arrives",
      script: { upload: "network-failure" },
      // A dropped connection and a server that is down look the same from here.
      says: /not available right now/i,
      cleansUp: true,
    },
    {
      label: "a server fault (500 internal)",
      script: { convert: refusal(500, "internal") },
      says: /not available right now/i,
      cleansUp: true,
    },
    {
      label: "too many conversions (429 rate_limited)",
      script: { create: refusal(429, "rate_limited") },
      says: /Wait a minute/i,
      never: /not available/i,
      cleansUp: false,
    },
  ];

  for (const verdict of VERDICTS) {
    test(`says the right thing for ${verdict.label}`, async ({ page }) => {
      const seen = await mockProcessor(page, verdict.script);
      await page.goto("/word-to-pdf");
      await wordInput(page).setInputFiles(docx());
      await convertButton(page).click();
      const said = await refusalText(page);
      expect(said).toMatch(verdict.says);
      if (verdict.never) expect(said).not.toMatch(verdict.never);
      await expect(downloads(page)).toHaveCount(0);
      if (verdict.cleansUp)
        expect(seen, "the job is deleted after a failure").toContain(
          "DELETE /jobs/job-1",
        );
      else expect(seen.filter((call) => call.startsWith("DELETE"))).toEqual([]);
    });
  }

  test("a good document converts after the server refused one", async ({
    page,
  }) => {
    let refuse = true;
    const seen: string[] = [];
    await mockProcessor(page, {});
    await page.route("**/api/processor/jobs/*/convert", async (route) => {
      seen.push("convert");
      if (!refuse) return route.fallback();
      refuse = false;
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          detail: { code: "conversion_failed", message: "x" },
        }),
      });
    });
    await page.goto("/word-to-pdf");
    await wordInput(page).setInputFiles(docx("first.docx"));
    await convertButton(page).click();
    expect(await refusalText(page)).toMatch(/could not finish/i);

    await wordInput(page).setInputFiles(docx("second.docx"));
    await expect(alerts(page)).toHaveCount(0);
    await convertButton(page).click();
    await expect(
      page.getByRole("heading", { name: "Your PDF is ready" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("link", { name: "Download PDF" }),
    ).toBeVisible();
    expect(seen).toHaveLength(2);
  });
});
