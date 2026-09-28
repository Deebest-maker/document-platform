import { PageError } from "./page-errors";

export interface PageReference {
  readonly id: string;
  readonly sourcePageNumber: number;
  readonly rotationDelta: number;
}
export interface PagePlan {
  readonly sessionId: string;
  readonly sourcePageCount: number;
  readonly pages: readonly PageReference[];
}
export interface PageGeometry {
  readonly sourcePageNumber: number;
  readonly crop: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly originalRotation: number;
}
export const normalizeRotation = (angle: number) => ((angle % 360) + 360) % 360;
const idFor = (sessionId: string, number: number) => `${sessionId}:${number}`;
const immutable = (plan: PagePlan): PagePlan =>
  Object.freeze({
    ...plan,
    pages: Object.freeze(plan.pages.map((page) => Object.freeze({ ...page }))),
  });

export function validatePagePlan(plan: PagePlan): void {
  if (
    !plan ||
    typeof plan.sessionId !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(plan.sessionId) ||
    !Number.isSafeInteger(plan.sourcePageCount) ||
    plan.sourcePageCount < 1 ||
    !Array.isArray(plan.pages) ||
    plan.pages.length < 1 ||
    plan.pages.length > plan.sourcePageCount
  )
    throw new PageError("INVALID_PLAN");
  const seen = new Set<string>();
  for (const page of plan.pages) {
    if (
      !page ||
      !Number.isSafeInteger(page.sourcePageNumber) ||
      page.sourcePageNumber < 1 ||
      page.sourcePageNumber > plan.sourcePageCount ||
      page.id !== idFor(plan.sessionId, page.sourcePageNumber) ||
      seen.has(page.id) ||
      ![0, 90, 180, 270].includes(page.rotationDelta)
    )
      throw new PageError("INVALID_PLAN");
    seen.add(page.id);
  }
}

export function createPagePlan(
  pageCount: number,
  sessionId: string = crypto.randomUUID(),
): PagePlan {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 10000)
    throw new PageError("PAGE_LIMIT");
  const plan = {
    sessionId,
    sourcePageCount: pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      id: idFor(sessionId, index + 1),
      sourcePageNumber: index + 1,
      rotationDelta: 0,
    })),
  };
  validatePagePlan(plan);
  return immutable(plan);
}

export function reorderPages(plan: PagePlan, ids: readonly string[]): PagePlan {
  validatePagePlan(plan);
  if (ids.length !== plan.pages.length || new Set(ids).size !== ids.length)
    throw new PageError("INVALID_PLAN");
  const byId = new Map(plan.pages.map((page) => [page.id, page]));
  const pages = ids.map((id) => {
    const page = byId.get(id);
    if (!page) throw new PageError("INVALID_PLAN");
    return page;
  });
  return immutable({ ...plan, pages });
}

function selection(plan: PagePlan, ids: readonly string[]): Set<string> {
  validatePagePlan(plan);
  const selected = new Set(ids);
  const known = new Set(plan.pages.map((page) => page.id));
  if (
    !ids.length ||
    ids.length !== selected.size ||
    ids.some((id) => !known.has(id))
  )
    throw new PageError("INVALID_PLAN");
  return selected;
}
export function extractPages(plan: PagePlan, ids: readonly string[]): PagePlan {
  const selected = selection(plan, ids);
  return immutable({
    ...plan,
    pages: plan.pages.filter(({ id }) => selected.has(id)),
  });
}
export function deletePages(plan: PagePlan, ids: readonly string[]): PagePlan {
  const selected = selection(plan, ids);
  const pages = plan.pages.filter(({ id }) => !selected.has(id));
  if (!pages.length) throw new PageError("INVALID_PLAN");
  return immutable({ ...plan, pages });
}
export function rotatePages(
  plan: PagePlan,
  ids: readonly string[] | "all",
  quarterTurn: number,
): PagePlan {
  const selected = selection(
    plan,
    ids === "all" ? plan.pages.map(({ id }) => id) : ids,
  );
  if (![0, 90, 180, 270, -90, -180, -270].includes(quarterTurn))
    throw new PageError("INVALID_PLAN");
  return immutable({
    ...plan,
    pages: plan.pages.map((page) =>
      selected.has(page.id)
        ? {
            ...page,
            rotationDelta: normalizeRotation(page.rotationDelta + quarterTurn),
          }
        : page,
    ),
  });
}
