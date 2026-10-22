/**
 * Inline links inside Learn copy (M6C, ADR-031).
 *
 * Article text may contain three kinds of token:
 *
 *   {tool:merge-pdf}                 link to an available tool, titled from the registry
 *   {tool:merge-pdf|joining files}   same, with your own words as the link text
 *   {learn:make-a-pdf-smaller|...}   link to another guide (text defaults to its title)
 *   {page:/privacy|Privacy page}     link to a static page (text is required)
 *
 * Resolving happens when a page is built, and a token that does not point at
 * something real throws. A guide can therefore never link to a tool that is
 * only planned, a guide that does not exist or a path that is not a page.
 */

import { getTool, getToolHref } from "@document-platform/tool-registry";
import { learnArticles } from "../content/learn-articles";
import { STATIC_INDEXABLE_PATHS } from "./seo";

export type ResolvedSegment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "link";
      readonly target: "tool" | "learn" | "page";
      readonly slug: string;
      readonly href: string;
      readonly label: string;
    };

const TOKEN = /\{(tool|learn|page):([^|{}]+)(?:\|([^{}]+))?\}/g;

function resolveToken(
  target: "tool" | "learn" | "page",
  slug: string,
  label: string | undefined,
): ResolvedSegment {
  if (target === "tool") {
    const tool = getTool(slug);
    if (!tool || tool.availability !== "available")
      throw new Error(`Learn link {tool:${slug}} is not an available tool`);
    return {
      kind: "link",
      target,
      slug,
      href: getToolHref(tool),
      label: label ?? tool.title,
    };
  }
  if (target === "learn") {
    const article = learnArticles.find((item) => item.slug === slug);
    if (!article) throw new Error(`Learn link {learn:${slug}} is not a guide`);
    return {
      kind: "link",
      target,
      slug,
      href: `/learn/${slug}`,
      label: label ?? article.title,
    };
  }
  const known = (STATIC_INDEXABLE_PATHS as readonly string[]).includes(slug);
  if (!known || slug === "/")
    throw new Error(`Learn link {page:${slug}} is not a static page`);
  if (!label) throw new Error(`Learn link {page:${slug}} needs link text`);
  return { kind: "link", target, slug, href: slug, label };
}

export function resolveInline(text: string): ResolvedSegment[] {
  const segments: ResolvedSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last)
      segments.push({ kind: "text", text: text.slice(last, match.index) });
    segments.push(
      resolveToken(
        match[1] as "tool" | "learn" | "page",
        match[2].trim(),
        match[3]?.trim(),
      ),
    );
    last = match.index + match[0].length;
  }
  if (last < text.length)
    segments.push({ kind: "text", text: text.slice(last) });
  if (segments.some((s) => s.kind === "text" && /[{}]/.test(s.text)))
    throw new Error(`Malformed link token in: ${text}`);
  return segments;
}

/** The text with every token replaced by its link text. */
export function plainText(text: string): string {
  return resolveInline(text)
    .map((segment) => (segment.kind === "text" ? segment.text : segment.label))
    .join("");
}
