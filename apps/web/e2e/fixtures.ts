import { test as base, expect, type Page } from "@playwright/test";

// Observe the entire context, including dedicated workers. Keep diagnostics coarse.
export const test = base.extend<{
  requestAudit: void;
  allowProcessorRequests: boolean;
}>({
  allowProcessorRequests: [false, { option: true }],
  requestAudit: [
    async ({ page, context, baseURL, allowProcessorRequests }, use) => {
      let unexpected = 0;
      let errors = 0;
      context.on("request", (request) => {
        const url = new URL(request.url());
        if (url.origin !== new URL(baseURL!).origin) {
          unexpected++;
          return;
        }
        if (allowProcessorRequests && /\/api\/processor\//.test(url.pathname)) {
          return;
        }
        if (
          !["GET", "HEAD"].includes(request.method()) ||
          /\/(api|uploads?|jobs|health)\//.test(url.pathname)
        ) {
          unexpected++;
        }
      });
      page.on("pageerror", () => errors++);
      page.on("websocket", () => unexpected++);
      await use();
      expect(
        unexpected,
        "No third-party, upload, processor or mutation requests",
      ).toBe(0);
      expect(errors, "No browser runtime errors").toBe(0);
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";

// A full-page screenshot is evidence for a reviewer, not an assertion. WebKit
// refuses to capture anything taller than 32,767 px, and a narrow viewport with
// enlarged text makes a long page that tall, so the capture is cut at 30,000 px
// instead of failing the test.
const MAX_EVIDENCE_HEIGHT = 30_000;
export async function evidenceScreenshot(
  page: Page,
  path: string,
): Promise<void> {
  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  await page.screenshot({
    path,
    fullPage: true,
    ...(height > MAX_EVIDENCE_HEIGHT
      ? { clip: { x: 0, y: 0, width, height: MAX_EVIDENCE_HEIGHT } }
      : {}),
  });
}
