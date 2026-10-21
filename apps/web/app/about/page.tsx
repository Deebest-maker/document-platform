import type { Metadata } from "next";
import Link from "next/link";
import {
  availabilityBreakdown,
  getAvailableTitles,
  listTitles,
  plannedRemainder,
} from "../../lib/availability";
import { seoMetadata } from "../../lib/seo";

export const metadata: Metadata = seoMetadata({
  title: "About this preview",
  description:
    "The purpose and current scope of the Document & File Platform preview.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <article className="reading-page">
      <p className="eyebrow">About</p>
      <h1>A toolkit in progress</h1>
      <p className="intro">
        Document &amp; File Platform is a working project name for a planned
        collection of document utilities.
      </p>
      <p className="notice">
        Product preview. {availabilityBreakdown()} {plannedRemainder()}
      </p>
      <h2>The intended approach</h2>
      <p>
        Use the browser for suitable document operations and explain clearly
        when an operation requires server processing.
      </p>
      <p>
        {listTitles(getAvailableTitles("LOCAL"))} create downloads locally in
        your browser. Word to PDF is the exception: it uploads your Word file to
        our server to convert it, and says so before anything is uploaded. The
        catalog also describes tools planned for future releases.
      </p>
      <Link className="text-link" href="/tools">
        Explore the tools
      </Link>
    </article>
  );
}
