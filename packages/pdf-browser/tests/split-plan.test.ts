import { describe, expect, it } from "vitest";
import { createPagePlan } from "../src/page-model";
import {
  expandSplitRange,
  parseSplitRangeSyntax,
  planSelectedPageSplits,
  planSplitRangeGroups,
  SplitRangeError,
} from "../src/split-plan";

const plan = createPagePlan(10, "split-session");
const pages = (value: string) =>
  expandSplitRange(parseSplitRangeSyntax(value), plan.sourcePageCount);

describe("FR-SPL range syntax and validation", () => {
  it.each([
    ["1", [1]],
    ["1-3", [1, 2, 3]],
    ["1,3,5", [1, 3, 5]],
    ["1-3,5,8-10", [1, 2, 3, 5, 8, 9, 10]],
    [" 1 - 3, 5 ", [1, 2, 3, 5]],
  ])("expands %s in user order", (input, expected) => {
    expect(pages(input)).toEqual(expected);
  });

  it.each([
    ["", "EMPTY_GROUP"],
    ["1,,3", "MALFORMED_RANGE"],
    ["one", "MALFORMED_RANGE"],
    ["-1", "NON_POSITIVE_PAGE"],
    ["0", "NON_POSITIVE_PAGE"],
    ["8-3", "REVERSED_RANGE"],
    ["11", "PAGE_OUT_OF_RANGE"],
    ["1,1", "DUPLICATE_PAGE"],
    ["1-3,3-5", "DUPLICATE_PAGE"],
  ])("rejects %j as %s", (input, code) => {
    try {
      pages(input);
      throw new Error("Expected range validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SplitRangeError);
      expect((error as SplitRangeError).code).toBe(code);
    }
  });

  it("allows source-page reuse across output groups and preserves typed order", () => {
    const outputs = planSplitRangeGroups(plan, ["1-3,5", "5-7", "10,8"]);
    expect(
      outputs.map((output) =>
        output.pages.map(({ sourcePageNumber }) => sourcePageNumber),
      ),
    ).toEqual([
      [1, 2, 3, 5],
      [5, 6, 7],
      [10, 8],
    ]);
  });

  it("reports the invalid group and enforces the output cap", () => {
    try {
      planSplitRangeGroups(plan, ["1", "2,2"]);
      throw new Error("Expected group validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "DUPLICATE_PAGE",
        details: { groupIndex: 1, page: 2 },
      });
    }
    expect(() => planSplitRangeGroups(plan, Array(21).fill("1"))).toThrow(
      "OUTPUT_LIMIT",
    );
  });

  it("creates one source-ordered output per selected stable page ID", () => {
    const selected = [plan.pages[6].id, plan.pages[1].id, plan.pages[3].id];
    expect(
      planSelectedPageSplits(plan, selected).map(
        (output) => output.pages[0].sourcePageNumber,
      ),
    ).toEqual([2, 4, 7]);
    expect(() => planSelectedPageSplits(plan, [])).toThrow("OUTPUT_LIMIT");
    expect(() =>
      planSelectedPageSplits(plan, [plan.pages[0].id, plan.pages[0].id]),
    ).toThrow("OUTPUT_LIMIT");
  });
});
