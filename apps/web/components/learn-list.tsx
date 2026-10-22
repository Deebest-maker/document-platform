import Link from "next/link";
import type { LearnArticle } from "../content/learn-articles";

/** Guide titles with their one-line summaries, for the hub and the home page. */
export function LearnList({
  articles,
  headingLevel = 3,
}: {
  articles: readonly LearnArticle[];
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="learn-list">
      {articles.map((article) => (
        <li className="learn-card" key={article.slug}>
          <Heading>
            <Link href={`/learn/${article.slug}`}>{article.title}</Link>
          </Heading>
          <p>{article.summary}</p>
        </li>
      ))}
    </ul>
  );
}
