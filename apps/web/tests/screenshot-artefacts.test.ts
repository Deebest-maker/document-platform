import { describe, expect, it } from "vitest";
import {
  noAllowanceSpent,
  withoutScreenshotArtefacts,
} from "../e2e/screenshot-artefacts";

const EVENT = "style-src-elem refused inline (page:5)";
const CONSOLE =
  "console: Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";

describe("withoutScreenshotArtefacts", () => {
  it("sets aside one event and one console line per screenshot in WebKit", () => {
    const spent = noAllowanceSpent();
    expect(
      withoutScreenshotArtefacts([EVENT, CONSOLE], 1, spent, "webkit"),
    ).toEqual([]);
    expect(spent).toEqual({ events: 1, console: 1 });
  });

  it("allows two of each for two screenshots, and reports a third", () => {
    const spent = noAllowanceSpent();
    const lines = [EVENT, CONSOLE, EVENT, CONSOLE, EVENT, CONSOLE];
    expect(withoutScreenshotArtefacts(lines, 2, spent, "webkit")).toEqual([
      EVENT,
      CONSOLE,
    ]);
  });

  it("allows nothing when no screenshot was taken", () => {
    expect(
      withoutScreenshotArtefacts(
        [EVENT, CONSOLE],
        0,
        noAllowanceSpent(),
        "webkit",
      ),
    ).toEqual([EVENT, CONSOLE]);
  });

  it("keeps the allowance across calls, so it is not spent twice", () => {
    const spent = noAllowanceSpent();
    expect(withoutScreenshotArtefacts([EVENT], 1, spent, "webkit")).toEqual([]);
    expect(withoutScreenshotArtefacts([EVENT], 1, spent, "webkit")).toEqual([
      EVENT,
    ]);
  });

  it("never touches any other refusal", () => {
    const others = [
      "script-src refused inline (page:1)",
      "style-src-attr refused inline (page:5)",
      "style-src-elem refused https://cdn.example/style.css (page:5)",
      "console: Refused to load the image 'https://x.example/a.png'",
      "console: Refused to execute inline script",
    ];
    expect(
      withoutScreenshotArtefacts(others, 10, noAllowanceSpent(), "webkit"),
    ).toEqual(others);
  });

  it("applies to WebKit only", () => {
    for (const engine of ["chromium", "firefox"]) {
      const spent = noAllowanceSpent();
      expect(
        withoutScreenshotArtefacts([EVENT, CONSOLE], 5, spent, engine),
      ).toEqual([EVENT, CONSOLE]);
      expect(spent).toEqual({ events: 0, console: 0 });
    }
  });
});
