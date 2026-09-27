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
import { displayName, errorCopy, formatBytes, MergeSession } from "./session";

const phases = {
  reading: "Reading and checking PDFs…",
  merging: "Combining pages in your chosen order…",
  validating: "Saving and validating the merged PDF…",
};
const support =
  "Page content is merged. Interactive forms, bookmarks and other document-level features may not be retained. Digital signatures will not remain valid. Keep your originals.";

export function MergeWorkspace({
  tool,
  related,
}: {
  tool: ToolDefinition;
  related: ReactNode;
}) {
  const [session] = useState(() => new MergeSession(tool.limits!));
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
  const limits = session.limits;
  function remove(id: string, index: number) {
    session.remove(id);
    requestAnimationFrame(() => {
      const rows =
        workspace.current?.querySelectorAll<HTMLElement>(".selected-file");
      const next =
        rows?.[
          Math.min(index, rows.length - 1)
        ]?.querySelector<HTMLButtonElement>("button");
      (
        next ??
        workspace.current?.querySelector<HTMLButtonElement>(
          ".file-picker button",
        )
      )?.focus();
    });
  }
  const selection = (
    <>
      <p className="eyebrow">01 Choose · 02 Arrange · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        {current.error
          ? "Check your selection"
          : current.rows.length
            ? "Arrange your PDFs"
            : "Bring your PDFs together"}
      </h2>
      {current.error && (
        <p className="merge-error">{errorCopy[current.error]}</p>
      )}
      <p className="small-copy">
        {current.rows.length
          ? "Pages stay in their original order within each file. Files with the same name remain separate selections."
          : "Choose at least two PDFs. Put the files in order, then create one document."}
      </p>
      <FilePicker
        accept={tool.acceptedTypes.flatMap((type) => type.extensions).join(",")}
        label={current.rows.length ? "Add PDFs" : "Choose PDFs"}
        help="Select files or drop them here. Nothing is uploaded."
        onFiles={(files) => session.add(files)}
      />
      {current.rows.length > 0 && (
        <>
          <p className="selection-summary">
            {current.rows.length} files ·{" "}
            {formatBytes(
              current.rows.reduce((sum, row) => sum + row.file.size, 0),
            )}{" "}
            total
          </p>
          <ol className="selected-files" aria-label="PDF merge order">
            {current.rows.map((row, index) => (
              <li className="selected-file" key={row.id}>
                <span className="file-position" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="file-description">
                  <strong>
                    <bdi dir="auto">{displayName(row.file.name)}</bdi>
                  </strong>
                  <span className="small-copy">
                    {formatBytes(row.file.size)}
                  </span>
                  {row.error && (
                    <p className="merge-error">{errorCopy[row.error]}</p>
                  )}
                </div>
                <div
                  className="file-actions"
                  role="group"
                  aria-label={`File ${index + 1} actions`}
                >
                  <button
                    className="quiet-button"
                    type="button"
                    aria-label={`Move file ${index + 1} earlier`}
                    aria-disabled={index === 0}
                    onClick={() => session.move(row.id, -1)}
                  >
                    Move earlier
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    aria-label={`Move file ${index + 1} later`}
                    aria-disabled={index === current.rows.length - 1}
                    onClick={() => session.move(row.id, 1)}
                  >
                    Move later
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    aria-label={`Remove file ${index + 1}`}
                    onClick={() => remove(row.id, index)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="merge-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!session.canMerge()}
          onClick={() => void session.merge()}
        >
          Merge PDFs
        </button>
        {current.rows.length > 0 && (
          <button
            className="quiet-button"
            type="button"
            onClick={session.reset}
          >
            Start over
          </button>
        )}
      </div>
      {current.rows.length === 1 && (
        <p className="small-copy">Add one more PDF to continue.</p>
      )}
      <p className="small-copy merge-limits">
        Current limits: {limits.maxFiles} files ·{" "}
        {formatBytes(limits.maxFileBytes)} per file ·{" "}
        {formatBytes(limits.maxTotalBytes)} combined · {limits.maxPages} pages ·{" "}
        {formatBytes(limits.maxOutputBytes)} output. Password-protected PDFs are
        not supported.
      </p>
      <p className="small-copy">{support}</p>
    </>
  );
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
        state={current.state}
        workspace={selection}
        error={selection}
        related={related}
        status={
          <>
            <p className="eyebrow">Working on your device</p>
            <h2 tabIndex={-1} data-state-heading>
              Creating your merged PDF
            </h2>
            <p>
              {current.phase
                ? phases[current.phase]
                : "Loading the local PDF engine…"}
            </p>
            <p className="small-copy">
              Keep this page open. No documents are being uploaded.
            </p>
            <button
              className="quiet-button"
              type="button"
              onClick={() => session.cancel()}
            >
              Cancel merge
            </button>
          </>
        }
        result={
          current.result && (
            <>
              <p className="eyebrow">Ready to save</p>
              <h2 tabIndex={-1} data-state-heading>
                Your merged PDF is ready
              </h2>
              <p>
                {current.result.inputCount} PDFs combined ·{" "}
                {current.result.pageCount} pages ·{" "}
                {formatBytes(current.result.blob.size)}
              </p>
              <div className="merge-actions">
                <a
                  className="primary-button"
                  href={current.result.url}
                  download="merged.pdf"
                >
                  Download merged PDF
                </a>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => session.edit()}
                >
                  Change files or order
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={session.reset}
                >
                  Start over
                </button>
              </div>
              <p className="small-copy">
                You can download again until you change the selection, start
                over or leave this page.
              </p>
              <p className="small-copy">{support}</p>
            </>
          )
        }
      />
    </div>
  );
}
