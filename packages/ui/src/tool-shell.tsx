import type { ReactNode } from "react";
import type { ToolDefinition } from "@document-platform/tool-registry";
import { PrivacyIndicator } from "./privacy-indicator";

export type ToolShellState =
  "idle" | "selected" | "processing" | "result" | "error";

interface ToolShellProps {
  tool: ToolDefinition;
  state: ToolShellState;
  workspace: ReactNode;
  status?: ReactNode;
  result?: ReactNode;
  error?: ReactNode;
  related?: ReactNode;
}

export function ToolShell({
  tool,
  state,
  workspace,
  status,
  result,
  error,
  related,
}: ToolShellProps) {
  return (
    <article className="tool-shell">
      <header className="tool-heading">
        <p className="eyebrow">
          {tool.availability === "available"
            ? "Document workspace"
            : "Tool preview · not available"}
        </p>
        <h1>{tool.title}</h1>
        <p className="intro">{tool.description}</p>
        <PrivacyIndicator
          processingMode={tool.processingMode}
          availability={tool.availability}
        />
      </header>
      <section className="tool-workspace" aria-label="Tool workspace">
        {(state === "idle" || state === "selected") && workspace}
        {state === "processing" && <div role="status">{status}</div>}
        {state === "result" && <section aria-label="Result">{result}</section>}
        {state === "error" && <div role="alert">{error}</div>}
      </section>
      {related && (
        <aside className="related-tools" aria-label="Related tools">
          {related}
        </aside>
      )}
    </article>
  );
}
