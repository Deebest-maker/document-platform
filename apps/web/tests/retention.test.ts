import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABANDONED_JOB_IDLE_MINUTES,
  ABANDONED_JOB_MAX_MINUTES,
  CLEANUP_INTERVAL_MINUTES,
  abandonedJobSentence,
} from "../lib/retention";
import { getToolGuide } from "../content/tool-guides";

/**
 * The retention wording is public. These tests tie it to the processor's real
 * settings so the two cannot drift apart (ADR-032).
 */
const ROOT = resolve(__dirname, "../../..");
const config = readFileSync(
  resolve(ROOT, "services/processor/app/config.py"),
  "utf8",
);

function seconds(name: string): number {
  const match = config.match(
    new RegExp(`${name}: Final\\[int\\] = (\\d+)(?: \\* (\\d+))?`),
  );
  expect(match, `${name} not found in config.py`).not.toBeNull();
  return Number(match![1]) * Number(match![2] ?? 1);
}

describe("ADR-032: the public retention wording matches the processor", () => {
  it("says the idle period and the cleanup interval the processor uses", () => {
    expect(seconds("_DEFAULT_JOB_LIFETIME_SECONDS")).toBe(
      ABANDONED_JOB_IDLE_MINUTES * 60,
    );
    expect(seconds("_DEFAULT_JANITOR_INTERVAL_SECONDS")).toBe(
      CLEANUP_INTERVAL_MINUTES * 60,
    );
    expect(ABANDONED_JOB_MAX_MINUTES).toBe(
      ABANDONED_JOB_IDLE_MINUTES + CLEANUP_INTERVAL_MINUTES,
    );
  });

  it("keeps the idle period above the longest a conversion can legitimately take", () => {
    const busy =
      seconds("_DEFAULT_RUNNER_TIMEOUT_SECONDS") +
      seconds("_DEFAULT_CONVERT_QUEUE_WAIT_SECONDS");
    expect(ABANDONED_JOB_IDLE_MINUTES * 60).toBeGreaterThan(busy);
  });

  it("is not overridden in the processor image or the CI workflow", () => {
    for (const file of [
      "services/processor/Dockerfile",
      ".github/workflows/ci.yml",
    ]) {
      expect(readFileSync(resolve(ROOT, file), "utf8"), file).not.toMatch(
        /PROCESSOR_JOB_LIFETIME_SECONDS|PROCESSOR_JANITOR_INTERVAL/,
      );
    }
  });

  it("reaches the Word to PDF guide as the same number", () => {
    const guide = getToolGuide("word-to-pdf")!;
    const text = guide.goodToKnow.join(" ");
    expect(text).toContain(`idle for ${ABANDONED_JOB_IDLE_MINUTES} minutes`);
    expect(text).not.toMatch(/after a short time/);
  });

  it("is one honest sentence that promises nothing the cleanup cannot do", () => {
    expect(abandonedJobSentence).toContain(
      `${ABANDONED_JOB_IDLE_MINUTES} minutes`,
    );
    expect(abandonedJobSentence).toContain(
      `${ABANDONED_JOB_MAX_MINUTES} minutes`,
    );
    expect(abandonedJobSentence).toMatch(/should be gone/);
    expect(abandonedJobSentence).not.toMatch(
      /\bguarantee|\balways\b|\bnever\b/i,
    );
  });
});
