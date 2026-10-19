"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ToolDefinition } from "@document-platform/tool-registry";
import { FilePicker, ToolShell } from "@document-platform/ui";
import {
  displayName,
  errorCopy,
  formatBytes,
  WordToPdfSession,
} from "./session";

const support =
  "Layout fidelity depends on the fonts and features used in the original document. Keep your original DOCX file.";

function progressPercent(loaded: number, total: number): string {
  if (total <= 0) return "";
  return `${Math.min(100, Math.round((loaded / total) * 100))}%`;
}

export function WordToPdfWorkspace({
  tool,
  related,
}: {
  tool: ToolDefinition;
  related: ReactNode;
}) {
  const [session] = useState(() => new WordToPdfSession(tool));
  const current = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const workspace = useRef<HTMLDivElement>(null);
  const previousState = useRef(current.state);

  useEffect(() => {
    window.addEventListener("pagehide", session.reset);
    return () => {
      window.removeEventListener("pagehide", session.reset);
      session.dispose();
    };
  }, [session]);

  useEffect(() => {
    if (previousState.current !== current.state) {
      workspace.current
        ?.querySelector<HTMLElement>("[data-state-heading]")
        ?.focus();
      previousState.current = current.state;
    }
  }, [current.state]);

  const maxFileBytes = tool.limits?.maxFileBytes ?? 20 * 1024 * 1024;

  const selection = (
    <>
      <p className="eyebrow">01 Choose · 02 Convert · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        {current.error
          ? "Check your selection"
          : current.file
            ? "Ready to convert"
            : "Convert your Word document to PDF"}
      </h2>
      {current.error && (
        <p className="merge-error">{errorCopy[current.error]}</p>
      )}
      <p className="small-copy">
        {current.file
          ? "Your file will be uploaded to our processing server for conversion. It is deleted automatically after processing."
          : "Choose a DOCX file. The document is uploaded for server-side conversion and deleted immediately after."}
      </p>
      <FilePicker
        accept=".docx"
        label={current.file ? "Choose a different file" : "Choose a DOCX file"}
        help="Select a file or drop it here."
        onFiles={(files) => session.select(files)}
        multiple={false}
      />
      {current.file && !current.error && (
        <p className="selection-summary">
          <bdi dir="auto">{displayName(current.file.name)}</bdi> &middot;{" "}
          {formatBytes(current.file.size)}
        </p>
      )}
      <div className="merge-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!session.canConvert()}
          onClick={() => void session.run()}
        >
          Convert to PDF
        </button>
        {current.file && (
          <button
            className="quiet-button"
            type="button"
            onClick={session.reset}
          >
            Start over
          </button>
        )}
      </div>
      <p className="small-copy merge-limits">
        Current limits: {formatBytes(maxFileBytes)} maximum file size.
        Password-protected and macro-enabled documents are not supported.
      </p>
      <p className="small-copy">{support}</p>
    </>
  );

  // Map uploading/converting to the ToolShell "processing" state.
  const shellState =
    current.state === "uploading" || current.state === "converting"
      ? "processing"
      : current.state;

  return (
    <div ref={workspace} className="merge-workflow">
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {current.announcement}
      </p>
      <ToolShell
        tool={tool}
        state={shellState}
        workspace={selection}
        error={selection}
        related={related}
        status={
          <>
            <p className="eyebrow">Secure server processing</p>
            <h2 tabIndex={-1} data-state-heading>
              {current.state === "uploading"
                ? "Uploading your document"
                : "Converting to PDF"}
            </h2>
            <p>
              {current.state === "uploading" && current.progress
                ? `Uploading${current.progress.total > 0 ? ` · ${progressPercent(current.progress.loaded, current.progress.total)}` : ""}…`
                : "Converting your document. This may take a moment for larger files."}
            </p>
            <p className="small-copy">
              Your file is processed over an encrypted connection and deleted
              after conversion.
            </p>
            <button
              className="quiet-button"
              type="button"
              onClick={() => session.cancel()}
            >
              Cancel
            </button>
          </>
        }
        result={
          current.result && (
            <>
              <p className="eyebrow">Ready to save</p>
              <h2 tabIndex={-1} data-state-heading>
                Your PDF is ready
              </h2>
              <p>
                {current.file && (
                  <>
                    <bdi dir="auto">{displayName(current.file.name)}</bdi>{" "}
                    &rarr;{" "}
                  </>
                )}
                {formatBytes(current.result.outputBytes)}
              </p>
              <div className="merge-actions">
                <a
                  className="primary-button"
                  href={current.result.url}
                  download="word-to-pdf.pdf"
                >
                  Download PDF
                </a>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={session.reset}
                >
                  Start over
                </button>
              </div>
              <p className="small-copy">
                The server copy has been deleted. You can download again until
                you start over or leave this page.
              </p>
              <p className="small-copy">{support}</p>
            </>
          )
        }
      />
    </div>
  );
}
