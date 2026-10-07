import {
  extractPages,
  reorderPages,
  validatePagePlan,
  type PagePlan,
} from "./page-model";

export const splitLimits = Object.freeze({
  maxOutputs: 20,
  maxCombinedPdfBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
});

export type SplitRangeErrorCode =
  | "EMPTY_GROUP"
  | "MALFORMED_RANGE"
  | "NON_POSITIVE_PAGE"
  | "REVERSED_RANGE"
  | "PAGE_OUT_OF_RANGE"
  | "DUPLICATE_PAGE"
  | "OUTPUT_LIMIT";

export class SplitRangeError extends Error {
  constructor(
    readonly code: SplitRangeErrorCode,
    readonly details: {
      readonly token?: string;
      readonly page?: number;
      readonly pageCount?: number;
      readonly groupIndex?: number;
    } = {},
  ) {
    super(code);
    this.name = "SplitRangeError";
  }
}

export type SplitRangeSegment = Readonly<{
  start: number;
  end: number;
  token: string;
}>;

const integer = (value: string, token: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new SplitRangeError("MALFORMED_RANGE", { token });
  if (parsed < 1)
    throw new SplitRangeError("NON_POSITIVE_PAGE", {
      token,
      page: parsed,
    });
  return parsed;
};

export function parseSplitRangeSyntax(input: string): SplitRangeSegment[] {
  const value = input.trim();
  if (!value) throw new SplitRangeError("EMPTY_GROUP");
  if (value.length > 1_000)
    throw new SplitRangeError("MALFORMED_RANGE", { token: value });
  return value.split(",").map((rawToken) => {
    const token = rawToken.trim();
    if (!token)
      throw new SplitRangeError("MALFORMED_RANGE", { token: rawToken });
    if (/^-\s*\d+$/.test(token))
      throw new SplitRangeError("NON_POSITIVE_PAGE", { token });
    const single = token.match(/^(\d+)$/);
    if (single) {
      const page = integer(single[1], token);
      return Object.freeze({ start: page, end: page, token });
    }
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!range) throw new SplitRangeError("MALFORMED_RANGE", { token });
    const start = integer(range[1], token);
    const end = integer(range[2], token);
    if (start > end)
      throw new SplitRangeError("REVERSED_RANGE", { token, page: start });
    return Object.freeze({ start, end, token });
  });
}

export function expandSplitRange(
  segments: readonly SplitRangeSegment[],
  pageCount: number,
): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1)
    throw new SplitRangeError("PAGE_OUT_OF_RANGE", { pageCount });
  const pages: number[] = [];
  const seen = new Set<number>();
  for (const segment of segments) {
    if (segment.end > pageCount)
      throw new SplitRangeError("PAGE_OUT_OF_RANGE", {
        token: segment.token,
        page: segment.end,
        pageCount,
      });
    for (let page = segment.start; page <= segment.end; page++) {
      if (seen.has(page))
        throw new SplitRangeError("DUPLICATE_PAGE", {
          token: segment.token,
          page,
          pageCount,
        });
      seen.add(page);
      pages.push(page);
    }
  }
  return pages;
}

function planForPages(plan: PagePlan, pages: readonly number[]): PagePlan {
  validatePagePlan(plan);
  const byNumber = new Map(
    plan.pages.map((page) => [page.sourcePageNumber, page]),
  );
  const ids = pages.map((page) => {
    const reference = byNumber.get(page);
    if (!reference)
      throw new SplitRangeError("PAGE_OUT_OF_RANGE", {
        page,
        pageCount: plan.sourcePageCount,
      });
    return reference.id;
  });
  return reorderPages(extractPages(plan, ids), ids);
}

export function planSplitRangeGroups(
  plan: PagePlan,
  groups: readonly string[],
  maxOutputs: number = splitLimits.maxOutputs,
): PagePlan[] {
  if (!groups.length || groups.length > maxOutputs)
    throw new SplitRangeError("OUTPUT_LIMIT");
  return groups.map((group, groupIndex) => {
    try {
      return planForPages(
        plan,
        expandSplitRange(parseSplitRangeSyntax(group), plan.sourcePageCount),
      );
    } catch (error) {
      if (error instanceof SplitRangeError)
        throw new SplitRangeError(error.code, {
          ...error.details,
          groupIndex,
        });
      throw error;
    }
  });
}

export function planSelectedPageSplits(
  plan: PagePlan,
  selectedIds: readonly string[],
  maxOutputs: number = splitLimits.maxOutputs,
): PagePlan[] {
  validatePagePlan(plan);
  const selected = new Set(selectedIds);
  if (
    !selected.size ||
    selected.size !== selectedIds.length ||
    selected.size > maxOutputs
  )
    throw new SplitRangeError("OUTPUT_LIMIT");
  const pages = plan.pages.filter(({ id }) => selected.has(id));
  if (pages.length !== selected.size)
    throw new SplitRangeError("PAGE_OUT_OF_RANGE", {
      pageCount: plan.sourcePageCount,
    });
  return pages.map((page) => extractPages(plan, [page.id]));
}
