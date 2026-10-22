import type { Metadata } from "next";
import Link from "next/link";
import { learnArticles } from "../../content/learn-articles";
import { LearnList } from "../../components/learn-list";
import { seoMetadata } from "../../lib/seo";

export const metadata: Metadata = seoMetadata({
  title: "Learn",
  description:
    "Plain-language guides to common PDF and file tasks: merging, shrinking, splitting, scanning, copying text and keeping documents private.",
  path: "/learn",
});

export default function LearnPage() {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Learn</p>
        <h1>Guides for everyday document tasks</h1>
        <p className="intro">
          Each guide explains how a task works, what to watch for and where the
          limits are, and points to the tool that does it. They are written for
          people with a document to sort out, not for specialists.
        </p>
      </header>
      <LearnList articles={learnArticles} headingLevel={2} />
      <p className="learn-hub-footer">
        Looking for a tool instead?{" "}
        <Link className="text-link" href="/tools">
          Browse all tools <span aria-hidden="true">→</span>
        </Link>
      </p>
    </>
  );
}
