import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FoundationPage from "./page";

describe("foundation page", () => {
  it("clearly communicates that document tools are not available", () => {
    const html = renderToStaticMarkup(<FoundationPage />);

    expect(html).toContain("Document &amp; File Platform");
    expect(html).toContain("Document tools are not available yet.");
    expect(html).not.toMatch(/<(button|input|form)\b/);
  });
});
