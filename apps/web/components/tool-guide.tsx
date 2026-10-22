import {
  getRelatedTools,
  type ToolDefinition,
} from "@document-platform/tool-registry";
import Link from "next/link";
import { getLearnArticlesForTool } from "../content/learn-articles";
import { getToolGuide } from "../content/tool-guides";
import { ToolList } from "./tool-list";

/**
 * Guide copy and related tools shown under a tool's workspace (M6B, ADR-029).
 * A server component: the text is in the HTML, with no script needed to read it.
 * The guide is written per tool (content/tool-guides.ts); the related list is
 * derived from the registry, as before. "Learn more" links to the Learn guides
 * that are about this tool (content/learn-articles.ts, M6C).
 */
export function ToolGuide({ tool }: { tool: ToolDefinition }) {
  const guide = getToolGuide(tool.slug);
  const learn = getLearnArticlesForTool(tool.slug);
  return (
    <>
      {guide && (
        <div className="tool-guide">
          <section aria-labelledby="guide-about">
            <h2 id="guide-about">{`About ${tool.title}`}</h2>
            <p>{guide.overview}</p>
          </section>
          <section aria-labelledby="guide-steps">
            <h2 id="guide-steps">{`How to use ${tool.title}`}</h2>
            <ol>
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="guide-notes">
            <h2 id="guide-notes">Good to know</h2>
            <ul>
              {guide.goodToKnow.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="guide-faq">
            <h2 id="guide-faq">Common questions</h2>
            {guide.faq.map((item) => (
              <div className="tool-guide-question" key={item.question}>
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </div>
            ))}
          </section>
          {learn.length > 0 && (
            <section aria-labelledby="guide-learn">
              <h2 id="guide-learn">Learn more</h2>
              <ul>
                {learn.map((article) => (
                  <li key={article.slug}>
                    <Link href={`/learn/${article.slug}`}>{article.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <aside className="related-tools" aria-label="Related tools">
        <h2>Related tools</h2>
        <ToolList records={getRelatedTools(tool)} />
      </aside>
    </>
  );
}
