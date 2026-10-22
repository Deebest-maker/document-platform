import { isCancelledPrefetch } from "./benign-page-errors";
import {
  noAllowanceSpent,
  withoutScreenshotArtefacts,
} from "./screenshot-artefacts";
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

// What the browser reports when the page's Content Security Policy (M7C,
// ADR-034) stops something. Two sources, because neither sees everything: the
// page's own `securitypolicyviolation` events, and the console lines browsers
// print for a refusal, which also cover Web Workers. The check at the end of
// every test is that nothing was refused. A test that provokes a refusal on
// purpose reads and clears them with `take()`.
export interface CspViolations {
  take(): string[];
}

const CONSOLE_REFUSAL = /Content[ -]Security[ -]Policy|^Refused to /i;

// Screenshots taken in this test, per page. WebKit's screenshot code adds a
// style element of its own, which the policy refuses; see screenshot-artefacts.ts.
// Take screenshots with pageScreenshot() or evidenceScreenshot() so they count.
const screenshotsTaken = new WeakMap<Page, number>();
const countScreenshot = (page: Page) =>
  screenshotsTaken.set(page, (screenshotsTaken.get(page) ?? 0) + 1);

export async function pageScreenshot(
  page: Page,
  options: Parameters<Page["screenshot"]>[0],
): Promise<void> {
  countScreenshot(page);
  await page.screenshot(options);
}

// The watch on its own, for tests that attack the policy on purpose and so
// cannot also run under the request audit below.
export const withCspWatch = base.extend<{ cspViolations: CspViolations }>({
  cspViolations: [
    async ({ page, context, browserName }, use) => {
      const seen: string[] = [];
      const spent = noAllowanceSpent();
      await context.exposeBinding("__reportCspViolation", (_source, line) => {
        seen.push(String(line).slice(0, 300));
      });
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const report = (
            window as unknown as { __reportCspViolation(line: string): void }
          ).__reportCspViolation;
          report(
            `${event.effectiveDirective || event.violatedDirective} refused ` +
              `${event.blockedURI || "inline"} ` +
              `(${event.sourceFile || "page"}:${event.lineNumber})`,
          );
        });
      });
      page.on("console", (message) => {
        if (CONSOLE_REFUSAL.test(message.text()))
          seen.push(`console: ${message.text()}`.slice(0, 300));
      });
      await use({
        take: () =>
          withoutScreenshotArtefacts(
            seen.splice(0),
            screenshotsTaken.get(page) ?? 0,
            spent,
            browserName,
          ),
      });
    },
    { scope: "test" },
  ],
});

// Observe the entire context, including dedicated workers. Keep diagnostics coarse.
export const test = withCspWatch.extend<{
  requestAudit: void;
  allowProcessorRequests: boolean;
}>({
  allowProcessorRequests: [false, { option: true }],
  requestAudit: [
    async (
      { page, context, baseURL, allowProcessorRequests, cspViolations },
      use,
    ) => {
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
      page.on("pageerror", (error) => {
        if (isCancelledPrefetch(error.message)) return;
        errors.push(`${page.url()} -> ${error.message}`.slice(0, 300));
      });
      page.on("websocket", (socket) => unexpected.push(`WS ${socket.url()}`));
      await use();
      expect(
        unexpected,
        "No third-party, upload, processor or mutation requests",
      ).toEqual([]);
      expect(errors, "No browser runtime errors").toEqual([]);
      expect(
        cspViolations.take(),
        "The Content Security Policy refused nothing",
      ).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";

// A full-page screenshot is evidence for a reviewer, not an assertion. WebKit
// refuses to capture anything taller than 32,767 device pixels (it grows the
// viewport to the page height, so clipping afterwards does not help), and a
// narrow viewport with enlarged text makes a long page that tall once the
// device pixel ratio is counted. Past 30,000 device pixels the capture falls
// back to the given region, or to the top of the page.
const MAX_EVIDENCE_PIXELS = 30_000;
export async function evidenceScreenshot(
  page: Page,
  path: string,
  region?: Locator,
): Promise<void> {
  const devicePixels = await page.evaluate(
    () => document.documentElement.scrollHeight * window.devicePixelRatio,
  );
  countScreenshot(page);
  if (devicePixels <= MAX_EVIDENCE_PIXELS) {
    await page.screenshot({ path, fullPage: true });
  } else if (region) {
    await region.screenshot({ path });
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path });
  }
}
