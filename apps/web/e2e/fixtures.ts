import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

// Observe the entire context, including dedicated workers. Keep diagnostics coarse.
export const test = base.extend<{
  requestAudit: void;
  allowProcessorRequests: boolean;
}>({
  allowProcessorRequests: [false, { option: true }],
  requestAudit: [
    async ({ page, context, baseURL, allowProcessorRequests }, use) => {
      // Keep what went wrong, not only how many times: a bare count is
      // unreadable in a CI annotation.
      const unexpected: string[] = [];
      const errors: string[] = [];
      const describe = (request: { method(): string; url(): string }) =>
        `${request.method()} ${request.url()}`;
      context.on("request", (request) => {
        const url = new URL(request.url());
        if (url.origin !== new URL(baseURL!).origin) {
          unexpected.push(describe(request));
          return;
        }
        if (allowProcessorRequests && /\/api\/processor\//.test(url.pathname)) {
          return;
        }
        if (
          !["GET", "HEAD"].includes(request.method()) ||
          /\/(api|uploads?|jobs|health)\//.test(url.pathname)
        ) {
          unexpected.push(describe(request));
        }
      });
      page.on("pageerror", (error) =>
        errors.push(`${page.url()} -> ${error.message}`.slice(0, 300)),
      );
      page.on("websocket", (socket) => unexpected.push(`WS ${socket.url()}`));
      await use();
      expect(
        unexpected,
        "No third-party, upload, processor or mutation requests",
      ).toEqual([]);
      expect(errors, "No browser runtime errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";

// A full-page screenshot is evidence for a reviewer, not an assertion. WebKit
// refuses to capture anything taller than 32,767 px (it grows the viewport to
// the page height, so clipping afterwards does not help), and a narrow viewport
// with enlarged text makes a long page that tall. Past 30,000 px the capture
// falls back to the given region, or to the top of the page.
const MAX_EVIDENCE_HEIGHT = 30_000;
export async function evidenceScreenshot(
  page: Page,
  path: string,
  region?: Locator,
): Promise<void> {
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  if (height <= MAX_EVIDENCE_HEIGHT) {
    await page.screenshot({ path, fullPage: true });
  } else if (region) {
    await region.screenshot({ path });
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path });
  }
}
