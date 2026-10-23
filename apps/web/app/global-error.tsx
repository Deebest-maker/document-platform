"use client";

import "./globals.css";

// Shown only when the page itself fails to start, in place of the whole page.
// Next.js's built-in version styles itself with inline <style> and style=""
// attributes, which the Content Security Policy refuses (ADR-034), so this one
// uses the site's stylesheet.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="page-width main-content">
          <article className="reading-page">
            <h1>Something went wrong</h1>
            <p className="intro">
              This page could not be shown. Try again, or reload the page.
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => reset()}
            >
              Try again
            </button>
          </article>
        </main>
      </body>
    </html>
  );
}
