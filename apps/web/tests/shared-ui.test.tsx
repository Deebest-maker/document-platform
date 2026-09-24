import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTool, type ProcessingMode } from "@document-platform/tool-registry";
import {
  PrivacyIndicator,
  ToolShell,
  type ToolShellState,
} from "@document-platform/ui";

describe("DEV-006: PrivacyIndicator", () => {
  it.each([
    ["LOCAL", "Planned: processed on your device"],
    ["SERVER", "Planned: server processing"],
    ["HYBRID", "Planned: processing location depends on the operation/options"],
  ] as const)(
    "FR-GEN-004: renders %s as a native disclosure",
    (processingMode, label) => {
      const html = renderToStaticMarkup(
        <PrivacyIndicator processingMode={processingMode} />,
      );
      expect(html).toContain("<details");
      expect(html).toContain(`<summary>${label}</summary>`);
      expect(html).not.toMatch(/Secure server|100% private/);
    },
  );

  it("derives the shell disclosure from the supplied tool mode", () => {
    const original = getTool("merge-pdf")!;
    const renderMode = (processingMode: ProcessingMode) =>
      renderToStaticMarkup(
        <ToolShell
          tool={{ ...original, processingMode }}
          state="idle"
          workspace={<p>Unavailable</p>}
        />,
      );
    expect(renderMode("LOCAL")).toContain("Planned: processed on your device");
    expect(renderMode("SERVER")).toContain("Planned: server processing");
    expect(renderMode("SERVER")).not.toContain(
      "Planned: processed on your device",
    );
  });
});

describe("DEV-006: generic ToolShell presentation regions", () => {
  it.each([
    ["idle", "Workspace content"],
    ["selected", "Workspace content"],
    ["processing", "Status content"],
    ["result", "Result content"],
    ["error", "Error content"],
  ] satisfies [ToolShellState, string][])(
    "renders only the active %s region",
    (state, visible) => {
      const html = renderToStaticMarkup(
        <ToolShell
          tool={{ ...getTool("word-to-pdf")!, title: "An unrelated tool" }}
          state={state}
          workspace={<p>Workspace content</p>}
          status={<p>Status content</p>}
          result={<p>Result content</p>}
          error={<p>Error content</p>}
          related={<p>Related content</p>}
        />,
      );
      expect(html).toContain("<h1>An unrelated tool</h1>");
      expect(html).toContain(visible);
      expect(html).toContain("Related content");
      for (const content of [
        "Workspace content",
        "Status content",
        "Result content",
        "Error content",
      ]) {
        if (content !== visible) expect(html).not.toContain(content);
      }
      if (state === "processing") expect(html).toContain('role="status"');
      if (state === "error") expect(html).toContain('role="alert"');
      expect(html).not.toMatch(/type="file"|<progress|<button|download=/);
    },
  );
});
