import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "../app/global-error";
import NotFound, { metadata } from "../app/not-found";

// The 404 page and the error page replace Next.js's built-in ones, which style
// themselves inline and so cannot run under the Content Security Policy
// (ADR-034). They must stay free of anything the policy refuses.

const pages = {
  "the 404 page": () => renderToStaticMarkup(<NotFound />),
  "the error page": () =>
    renderToStaticMarkup(<GlobalError reset={() => {}} />),
};

describe.each(Object.entries(pages))("%s", (_name, render) => {
  const html = render();

  it("has no inline style, style attribute, handler or script", () => {
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("says what happened in plain words", () => {
    expect(html).toMatch(/<h1>/);
  });
});

describe("the 404 page", () => {
  it("is not indexed, and links back into the site", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('href="/tools"');
    expect(html).toContain('href="/"');
  });
});

describe("the error page", () => {
  it("is a whole document, because it replaces the layout", () => {
    const html = renderToStaticMarkup(<GlobalError reset={() => {}} />);
    expect(html).toMatch(/^<html lang="en">.*<body>/s);
    expect(html).toContain("Try again");
  });
});
