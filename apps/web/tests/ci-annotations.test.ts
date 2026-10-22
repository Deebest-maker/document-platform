import { describe, expect, it } from "vitest";
import {
  collectFailures,
  formatAnnotations,
  type PlaywrightFailure,
} from "../../../scripts/ci-playwright-annotations.mjs";

const report = {
  stats: { expected: 2, unexpected: 2, flaky: 1, skipped: 0 },
  suites: [
    {
      file: "e2e/a.spec.ts",
      specs: [
        {
          title: "passes",
          file: "e2e/a.spec.ts",
          line: 3,
          tests: [
            {
              projectName: "chromium",
              status: "expected",
              results: [{ status: "passed" }],
            },
          ],
        },
      ],
      suites: [
        {
          title: "nested",
          specs: [
            {
              title: "breaks in firefox",
              file: "e2e/a.spec.ts",
              line: 12,
              tests: [
                {
                  projectName: "firefox",
                  status: "unexpected",
                  results: [
                    {
                      status: "failed",
                      error: {
                        message:
                          "\u001b[31mExpected 1\u001b[39m\nReceived 0\nmore",
                      },
                    },
                  ],
                },
                {
                  projectName: "webkit",
                  status: "flaky",
                  results: [
                    { status: "failed", error: { message: "first try" } },
                    { status: "passed" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("Playwright failure annotations", () => {
  it("collects failed and flaky tests from nested suites and ignores passes", () => {
    const failures: PlaywrightFailure[] = collectFailures(report);
    expect(failures.map((f) => [f.project, f.kind, f.title])).toEqual([
      ["firefox", "failed", "breaks in firefox"],
      ["webkit", "flaky", "breaks in firefox"],
    ]);
  });

  it("strips colour codes and keeps the first lines of the error", () => {
    const [first] = collectFailures(report);
    expect(first.message).toBe("Expected 1 | Received 0 | more");
  });

  it("writes one error command per browser project with the file and line", () => {
    const commands = formatAnnotations(collectFailures(report));
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatch(
      /^::error title=Playwright firefox%3A 1 not passing::/,
    );
    expect(commands[0]).toContain("e2e/a.spec.ts:12 breaks in firefox");
    expect(commands[1]).toContain("[flaky]");
  });

  it("escapes newlines and percent signs so a command stays on one line", () => {
    const [command] = formatAnnotations([
      {
        project: "firefox",
        kind: "failed",
        file: "f.ts",
        line: 1,
        title: "100% broken\nsecond line",
        message: "x",
      },
    ]);
    expect(command).not.toContain("\n");
    expect(command).toContain("100%25 broken%0Asecond line");
  });

  it("reports nothing when everything passed", () => {
    expect(formatAnnotations(collectFailures({ suites: [] }))).toEqual([]);
  });
});
