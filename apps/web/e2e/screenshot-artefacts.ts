/**
 * What Playwright's own screenshot code does to a page under the Content
 * Security Policy (M7C, ADR-034).
 *
 * Before it captures a page, Playwright's WebKit driver adds `<style>body {}</style>`
 * to the document and removes it again, to make the engine settle animations.
 * The page policy allows no inline styles, so WebKit refuses it and reports one
 * `style-src-elem` violation (an event) and one console line per screenshot.
 * The page did nothing wrong and nothing visible changes; the refusal is the
 * policy working on the test tool's own element.
 *
 * Only that shape, and only as many as screenshots were taken, is set aside.
 * A third report, or any other refusal in the same test, still fails it.
 */

const SCREENSHOT_STYLE_EVENT = /^style-src-elem refused inline \(page:\d+\)$/;
const SCREENSHOT_STYLE_CONSOLE = /^console: Refused to apply a stylesheet\b/;

export interface ScreenshotAllowance {
  events: number;
  console: number;
}

export function noAllowanceSpent(): ScreenshotAllowance {
  return { events: 0, console: 0 };
}

/**
 * Removes the refusals the screenshots explain and returns the rest.
 *
 * @param lines       what the watch recorded
 * @param screenshots how many screenshots the test has taken so far
 * @param spent       the allowance already used by earlier calls (updated)
 * @param engine      only WebKit does this; any other engine keeps every line
 */
export function withoutScreenshotArtefacts(
  lines: readonly string[],
  screenshots: number,
  spent: ScreenshotAllowance,
  engine: string,
): string[] {
  if (engine !== "webkit") return [...lines];
  return lines.filter((line) => {
    if (SCREENSHOT_STYLE_EVENT.test(line) && spent.events < screenshots) {
      spent.events += 1;
      return false;
    }
    if (SCREENSHOT_STYLE_CONSOLE.test(line) && spent.console < screenshots) {
      spent.console += 1;
      return false;
    }
    return true;
  });
}
