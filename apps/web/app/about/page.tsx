import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About this preview",
  description:
    "The purpose and current scope of the Document & File Platform preview.",
};

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
        Product preview. Merge PDF is available on your device. All other tools
        are planned.
      </p>
      <h2>The intended approach</h2>
      <p>
        Use the browser for suitable document operations and explain clearly
        when a future operation will require server processing.
      </p>
      <p>
        Merge PDF combines pages locally and creates a download in your browser.
        The catalog also describes tools planned for future releases.
      </p>
      <Link className="text-link" href="/tools">
        Explore the tools
      </Link>
    </article>
  );
}
