import type { Metadata } from "next";
import Link from "next/link";

// Our own page instead of Next.js's built-in one: the built-in page styles
// itself with inline <style> and style="" attributes, which the Content
// Security Policy refuses (ADR-034). It also keeps the 404 inside the site.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <article className="reading-page">
      <p className="eyebrow">404</p>
      <h1>This page does not exist</h1>
      <p className="intro">
        The address may be mistyped, or the page may have moved. Nothing you
        opened in a tool is affected.
      </p>
      <p>
        <Link className="text-link" href="/tools">
          Explore the tools
        </Link>
        {" · "}
        <Link className="text-link" href="/">
          Go to the home page
        </Link>
      </p>
    </article>
  );
}
