import type { Metadata } from "next";
import { seoMetadata } from "../../lib/seo";

export const metadata: Metadata = seoMetadata({
  title: "Terms — placeholder",
  description: "Terms have not been finalized for this product preview.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <article className="reading-page">
      <p className="eyebrow">Terms</p>
      <h1>Terms are being prepared</h1>
      <p className="notice">
        Placeholder — final terms have not been approved.
      </p>
      <p className="intro">
        This is an early product preview. Eleven tools are available for local
        processing; other document tools are planned.
      </p>
      <p>
        The approved terms will be provided before public launch. This page does
        not establish service guarantees, legal commitments or
        document-processing conditions.
      </p>
    </article>
  );
}
