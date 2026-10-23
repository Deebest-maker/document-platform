"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
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
  // While a tool is working, its workspace is replaced by a short status line.
  // Whatever sits below (the guide to the tool) would ride up into view and
  // then be pushed back down when the result arrives, which is two layout
  // shifts for one action. So the workspace keeps the height it had until the
  // work is done. This runs before the browser paints, and sets a style only
  // while processing, so nothing is held afterwards.
  const workspaceRef = useRef<HTMLElement>(null);
  const settledHeight = useRef(0);
  useLayoutEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    if (state === "processing") {
      element.style.minHeight = `${settledHeight.current}px`;
    } else {
      element.style.minHeight = "";
      settledHeight.current = element.offsetHeight;
    }
  }, [state]);
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
      <section
        className="tool-workspace"
        aria-label="Tool workspace"
        ref={workspaceRef}
      >
        {(state === "idle" || state === "selected") && workspace}
        {state === "processing" && <div role="status">{status}</div>}
        {state === "result" && <section aria-label="Result">{result}</section>}
        {state === "error" && <div role="alert">{error}</div>}
      </section>
      {related && <div className="tool-extras">{related}</div>}
    </article>
  );
}
