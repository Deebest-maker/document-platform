import type { Metadata } from "next";
import { seoMetadata } from "../../lib/seo";

export const metadata: Metadata = seoMetadata({
  title: "Contact — placeholder",
  description:
    "A contact channel has not yet been published for this product preview.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <article className="reading-page">
      <p className="eyebrow">Contact</p>
      <h1>A contact channel is coming</h1>
      <p className="notice">
        Placeholder — contact details have not been approved.
      </p>
      <p className="intro">
        There is no contact form or published support address in this preview.
      </p>
      <p>
        An approved contact channel will be added before public launch. This
        page does not accept documents or personal information.
      </p>
    </article>
  );
}
