import type { Metadata } from "next";
import Link from "next/link";
import { getTool, getToolHref } from "@document-platform/tool-registry";
import {
  getLearnArticle,
  type LearnArticle,
  type LearnBlock,
  type LearnSection,
} from "../content/learn-articles";
import { seoMetadata } from "../lib/seo";
import { LearnInline } from "./learn-inline";

function requireArticle(slug: string): LearnArticle {
  const article = getLearnArticle(slug);
  if (!article) throw new Error(`No Learn guide with slug "${slug}"`);
  return article;
}

/** Anchor id for a section heading, e.g. "Get the order right, then tidy". */
export function sectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function learnMetadata(slug: string): Metadata {
  const article = requireArticle(slug);
  return seoMetadata({
    title: article.title,
    description: article.description,
    path: `/learn/${article.slug}`,
  });
}

function Block({ block }: { block: LearnBlock }) {
  if (typeof block === "string")
    return (
      <p>
        <LearnInline text={block} />
      </p>
    );
  if ("steps" in block)
    return (
      <ol>
        {block.steps.map((step) => (
          <li key={step}>
            <LearnInline text={step} />
          </li>
        ))}
      </ol>
    );
  return (
    <ul>
      {block.list.map((item) => (
        <li key={item}>
          <LearnInline text={item} />
        </li>
      ))}
    </ul>
  );
}

function Section({ section }: { section: LearnSection }) {
  const id = sectionId(section.heading);
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{section.heading}</h2>
      {section.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </section>
  );
}

export function LearnArticlePage({ slug }: { slug: string }) {
  const article = requireArticle(slug);
  const toolRecords = article.tools.map((toolSlug) => {
    const tool = getTool(toolSlug);
    if (!tool || tool.availability !== "available")
      throw new Error(
        `Guide ${slug} lists ${toolSlug}, which is not available`,
      );
    return tool;
  });
  const related = article.related.map((relatedSlug) =>
    requireArticle(relatedSlug),
  );
  return (
    <article className="learn-article">
      <header className="learn-header">
        <p className="eyebrow">
          <Link href="/learn">Learn</Link>
        </p>
        <h1>{article.title}</h1>
        <p className="intro">
          <LearnInline text={article.intro} />
        </p>
      </header>
      <nav className="learn-contents" aria-label="In this guide">
        <h2 className="learn-contents-title">In this guide</h2>
        <ol>
          {article.sections.map((section) => (
            <li key={section.heading}>
              <a href={`#${sectionId(section.heading)}`}>{section.heading}</a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="learn-body">
        {article.sections.map((section) => (
          <Section key={section.heading} section={section} />
        ))}
      </div>
      <aside className="learn-aside" aria-label="Tools in this guide">
        <h2>Tools in this guide</h2>
        <ul>
          {toolRecords.map((tool) => (
            <li key={tool.slug}>
              <Link href={getToolHref(tool)}>{tool.title}</Link>
            </li>
          ))}
        </ul>
      </aside>
      {related.length > 0 && (
        <aside className="learn-aside" aria-label="Keep reading">
          <h2>Keep reading</h2>
          <ul>
            {related.map((item) => (
              <li key={item.slug}>
                <Link href={`/learn/${item.slug}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </article>
  );
}
