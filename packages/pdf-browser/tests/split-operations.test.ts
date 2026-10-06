import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createPagePlan } from "../src/page-model";
import { planSplitRangeGroups, splitLimits } from "../src/split-plan";
import { splitPdf } from "../src/split-operations";
import { pageLimits } from "../src/page-types";
import { fixtureBytes, inspectPages } from "./helpers/pdf-assertions";

const original = fixtureBytes("preview-features.pdf");
const input = {
  id: "split-operation",
  blob: new Blob([original], { type: "application/pdf" }),
};
const plan = createPagePlan(4, input.id);

describe("FR-SPL atomic structural output", () => {
  it("returns one validated PDF directly", async () => {
    const [group] = planSplitRangeGroups(plan, ["1-3"]);
    const phases: string[] = [];
    const result = await splitPdf(input, [group], pageLimits, splitLimits, {
      onPhase: (phase) => phases.push(phase),
    });
    expect(result).toMatchObject({
      kind: "pdf",
      fileCount: 1,
      pageCount: 3,
    });
    expect(result.blob.type).toBe("application/pdf");
    expect(
      (await inspectPages(await result.blob.arrayBuffer())).map(
        ({ marker }) => marker,
      ),
    ).toEqual(["P1", "P2", "P3"]);
    expect(phases).toEqual(["reading", "transforming", "validating"]);
  });

  it("packages multiple validated outputs with safe ordered names", async () => {
    const groups = planSplitRangeGroups(plan, ["1-3", "3-4"]);
    const result = await splitPdf(input, groups, pageLimits, splitLimits);
    expect(result).toMatchObject({
      kind: "zip",
      fileCount: 2,
      pageCount: 5,
    });
    expect(result.blob.type).toBe("application/zip");
    const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(["split-01.pdf", "split-02.pdf"]);
    expect(
      (await inspectPages(entries["split-01.pdf"])).map(({ marker }) => marker),
    ).toEqual(["P1", "P2", "P3"]);
    expect(
      (await inspectPages(entries["split-02.pdf"])).map(({ marker }) => marker),
    ).toEqual(["P3", "P4"]);
  });

  it("fails the whole batch for limits, invalid plans and cancellation", async () => {
    const groups = planSplitRangeGroups(plan, ["1", "2"]);
    await expect(
      splitPdf(input, groups, pageLimits, {
        ...splitLimits,
        maxCombinedPdfBytes: 1,
      }),
    ).rejects.toThrow("OUTPUT_LIMIT");
    await expect(
      splitPdf(input, groups, pageLimits, {
        ...splitLimits,
        maxArchiveBytes: 1,
      }),
    ).rejects.toThrow("OUTPUT_LIMIT");
    await expect(
      splitPdf(
        input,
        [{ ...groups[0], sessionId: "other" }],
        pageLimits,
        splitLimits,
      ),
    ).rejects.toThrow("INVALID_PLAN");
    const abort = new AbortController();
    await expect(
      splitPdf(input, groups, pageLimits, splitLimits, {
        signal: abort.signal,
        onPhase: (phase) => {
          if (phase === "archiving") abort.abort();
        },
      }),
    ).rejects.toThrow("CANCELLED");
  });
});
