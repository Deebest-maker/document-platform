import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { tools, type ToolDefinition } from "@document-platform/tool-registry";
import AboutPage from "../app/about/page";
import HomePage from "../app/page";
import PrivacyPage from "../app/privacy/page";
import TermsPage from "../app/terms/page";
import ToolsPage, { metadata as toolsMetadata } from "../app/tools/page";
import RootLayout from "../app/layout";
import { SiteFooter } from "../components/site-footer";
import {
  availabilityBreakdown,
  availabilityStatus,
  capitalise,
  countWord,
  getAvailabilitySummary,
  getAvailableTitles,
  getModeAvailability,
  listTitles,
  plannedRemainder,
} from "../lib/availability";

/**
 * Site copy about how many tools exist, and where they process files, must
 * follow the registry (M6B.1). The Tools page once said "Eleven tools are
 * available" when twelve were, and the Privacy page said every available tool
 * runs in the browser while Word to PDF uploads files to a server.
 */

function textOf(markup: string) {
  return markup
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function record(
  slug: string,
  processingMode: ToolDefinition["processingMode"],
  availability: ToolDefinition["availability"],
): ToolDefinition {
  return {
    slug,
    title: slug.toUpperCase(),
    processingMode,
    availability,
  } as ToolDefinition;
}

const summary = getAvailabilitySummary();
const serverTitles = getAvailableTitles("SERVER");

describe("availability wording helpers", () => {
  it("counts the registry: local, server and planned add up", () => {
    expect(summary.available).toBe(
      tools.filter((tool) => tool.availability === "available").length,
    );
    expect(summary.local + summary.server).toBe(summary.available);
    expect(summary.available + summary.planned).toBe(tools.length);
    expect(summary.local).toBeGreaterThan(0);
    expect(summary.server).toBeGreaterThan(0);
  });

  it("writes number words up to twenty and digits after", () => {
    expect(countWord(1)).toBe("one");
    expect(countWord(11)).toBe("eleven");
    expect(countWord(12)).toBe("twelve");
    expect(countWord(21)).toBe("21");
    expect(capitalise(countWord(12))).toBe("Twelve");
  });

  it("joins titles without a serial comma", () => {
    expect(listTitles(["A", "B", "C"])).toBe("A, B and C");
    expect(listTitles(["A", "B"])).toBe("A and B");
    expect(listTitles(["A"])).toBe("A");
  });

  it("describes a mixed catalog", () => {
    const records = [
      record("a", "LOCAL", "available"),
      record("b", "LOCAL", "available"),
      record("c", "SERVER", "available"),
      record("d", "SERVER", "planned"),
    ];
    const s = getAvailabilitySummary(records);
    expect(s).toMatchObject({ available: 3, local: 2, server: 1, planned: 1 });
    expect(availabilityStatus(s)).toBe(
      "Two tools work on your device. C uses our server. Another tool is planned.",
    );
    expect(availabilityBreakdown(s)).toBe(
      "Three tools are available: two work on your device and C uploads your file to our server.",
    );
    expect(plannedRemainder(s)).toBe(
      "The remaining tool is planned and cannot process documents yet.",
    );
  });

  it("handles singular, plural and empty cases", () => {
    const onlyLocal = getAvailabilitySummary([
      record("a", "LOCAL", "available"),
    ]);
    expect(availabilityStatus(onlyLocal)).toBe(
      "One tool works on your device.",
    );
    expect(availabilityBreakdown(onlyLocal)).toBe(
      "One tool is available: one works on your device.",
    );
    expect(plannedRemainder(onlyLocal)).toBe("");

    const twoServer = getAvailabilitySummary([
      record("a", "LOCAL", "available"),
      record("b", "SERVER", "available"),
      record("c", "SERVER", "available"),
      record("d", "LOCAL", "planned"),
      record("e", "LOCAL", "planned"),
    ]);
    expect(availabilityStatus(twoServer)).toBe(
      "One tool works on your device. B and C use our server. Other tools are planned.",
    );
    expect(availabilityBreakdown(twoServer)).toBe(
      "Three tools are available: one works on your device and B and C upload your files to our server.",
    );
    expect(plannedRemainder(twoServer)).toBe(
      "The remaining tools are planned and cannot process documents yet.",
    );
  });

  it("marks a processing mode planned only while no available tool uses it", () => {
    expect(getModeAvailability("LOCAL")).toBe("available");
    expect(getModeAvailability("SERVER")).toBe("available");
    expect(getModeAvailability("HYBRID")).toBe("planned");
    expect(
      getModeAvailability("SERVER", [record("a", "SERVER", "planned")]),
    ).toBe("planned");
  });
});

describe("site copy follows the registry", () => {
  const pages = {
    home: () => renderToStaticMarkup(<HomePage />),
    tools: () => renderToStaticMarkup(<ToolsPage />),
    about: () => renderToStaticMarkup(<AboutPage />),
    privacy: () => renderToStaticMarkup(<PrivacyPage />),
    terms: () => renderToStaticMarkup(<TermsPage />),
    footer: () => renderToStaticMarkup(<SiteFooter />),
    layout: () =>
      renderToStaticMarkup(
        <RootLayout>
          <p>content</p>
        </RootLayout>,
      ),
  } as const;

  it("states the current counts on the Tools page and in its description", () => {
    const text = textOf(pages.tools());
    expect(text).toContain(availabilityBreakdown(summary));
    expect(text).toContain(plannedRemainder(summary));
    expect(toolsMetadata.description).toContain(availabilityBreakdown(summary));
  });

  it("shows the same availability line in the preview banner and the footer", () => {
    const status = availabilityStatus(summary);
    expect(textOf(pages.layout())).toContain(status);
    expect(textOf(pages.footer())).toContain(status);
  });

  it("says which tool uses the server on About, Home, Terms and Privacy", () => {
    for (const [name, render] of Object.entries(pages)) {
      if (name === "tools" || name === "footer" || name === "layout") continue;
      const text = textOf(render());
      for (const title of serverTitles)
        expect(text, `${name} page names ${title}`).toContain(title);
    }
  });

  it("About lists every on-device tool, so a new tool cannot be left out", () => {
    const text = textOf(pages.about());
    for (const title of getAvailableTitles("LOCAL"))
      expect(text, title).toContain(title);
  });

  it("Privacy no longer claims every available tool stays in the browser", () => {
    const text = textOf(pages.privacy());
    expect(text).toContain(
      `${capitalise(countWord(summary.local))} of the ${countWord(summary.available)} available tools process documents and images entirely in your browser`,
    );
    expect(text).toContain(
      "For those tools, document bytes are never uploaded",
    );
    expect(text).toContain("Word to PDF uploads your Word file");
    expect(text).toMatch(/deleted automatically after a short time/);
    // Retention periods are an open Product Owner decision: no number here.
    expect(text).not.toMatch(/\b\d+\s*(minutes?|min|hours?|seconds?)\b/i);
    // It must not say server tools are still to come.
    expect(text).not.toMatch(/before server tools become available/i);
  });

  it("Home and Privacy label the local and server modes as live, hybrid as planned", () => {
    for (const html of [pages.home(), pages.privacy()]) {
      // Only the mode explanations: the home page also lists PDF to Word,
      // a planned server tool that is correctly labelled "Planned".
      const block = html.match(
        /<div class="privacy-explanations">((?:(?!<\/div>).)*)<\/div>/s,
      );
      expect(block, "mode explanations are rendered").not.toBeNull();
      const text = textOf(block![1]);
      expect(text).toContain("Processed on your device");
      expect(text).toContain("Secure server processing");
      expect(text).toContain(
        "Planned: processing location depends on the operation/options",
      );
      expect(text).not.toContain("Planned: server processing");
      expect(text).not.toContain("Planned: processed on your device");
    }
  });

  it("only says N tools are available when N is the number of available tools", () => {
    const pattern =
      /\b(\w+) (?:of the \w+ )?(?:available )?tools? (?:is|are) available\b/gi;
    for (const [name, render] of Object.entries(pages)) {
      for (const match of textOf(render()).matchAll(pattern))
        expect(match[1].toLowerCase(), `${name}: "${match[0]}"`).toBe(
          countWord(summary.available),
        );
    }
  });

  it("never quotes a tool count that the registry does not support", () => {
    const allowed = new Set([
      summary.available,
      summary.local,
      summary.server,
      summary.planned,
    ]);
    const words = new Map(
      Array.from({ length: 21 }, (_, n) => [countWord(n), n] as const),
    );
    const pattern = new RegExp(
      `\\b(${[...words.keys()].join("|")})\\s+(?:of the\\s+\\w+\\s+)?(?:available\\s+)?tools?\\b`,
      "gi",
    );
    for (const [name, render] of Object.entries(pages)) {
      const text = textOf(render());
      for (const match of text.matchAll(pattern)) {
        const count = words.get(match[1].toLowerCase())!;
        expect(
          allowed.has(count),
          `${name}: "${match[0]}" is not a registry count`,
        ).toBe(true);
      }
    }
  });
});
