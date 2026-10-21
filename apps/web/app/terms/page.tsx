import type { Metadata } from "next";
import {
  capitalise,
  countWord,
  getAvailabilitySummary,
} from "../../lib/availability";
import { seoMetadata } from "../../lib/seo";

export const metadata: Metadata = seoMetadata({
  title: "Terms — placeholder",
  description: "Terms have not been finalized for this product preview.",
  path: "/terms",
});

export default function TermsPage() {
  const summary = getAvailabilitySummary();
  return (
    <article className="reading-page">
      <p className="eyebrow">Terms</p>
      <h1>Terms are being prepared</h1>
      <p className="notice">
        Placeholder — final terms have not been approved.
      </p>
      <p className="intro">
        This is an early product preview. {capitalise(countWord(summary.local))}{" "}
        tools process files locally in your browser, Word to PDF converts files
        on our server, and other document tools are planned.
      </p>
      <p>
        The approved terms will be provided before public launch. This page does
        not establish service guarantees, legal commitments or
        document-processing conditions.
      </p>
    </article>
  );
}
