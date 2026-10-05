"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { normalizeRotation } from "@document-platform/pdf-browser/page-model";
import type { ToolDefinition } from "@document-platform/tool-registry";
import { FilePicker, ToolShell } from "@document-platform/ui";
import { formatBytes } from "../merge/session";
import { usePagePreview } from "../pdf-preview/use-page-preview";
import { pagePhaseCopy, pageToolErrors, pageToolState } from "./copy";
import { PageSelectionGrid } from "./page-selection-grid";

const deltaLabel = (delta: number) => {
  if (delta === 270) return "−90°";
  if (delta > 0) return `+${delta}°`;
  return "0°";
};

export function RotateWorkspace({
  tool,
  related,
}: {
  tool: ToolDefinition;
  related: ReactNode;
}) {
  const limits = tool.limits!;
  const { snapshot, session, registerCanvas } = usePagePreview({
    maxInputBytes: limits.maxFileBytes,
    maxPages: limits.maxPages,
    maxOutputBytes: limits.maxOutputBytes,
  });
  const root = useRef<HTMLDivElement>(null);
  const previousState = useRef(snapshot.state);
  useEffect(() => {
    if (previousState.current !== snapshot.state) {
      root.current?.querySelector<HTMLElement>("[data-state-heading]")?.focus();
      previousState.current = snapshot.state;
    }
  }, [snapshot.state]);

  const selectedCount = snapshot.selected.length;
  const changedCount =
    snapshot.plan?.pages.filter(({ rotationDelta }) => rotationDelta !== 0)
      .length ?? 0;
  const busy = snapshot.state === "exporting";
  const choose = (label = "Choose PDF") => (
    <FilePicker
      accept={tool.acceptedTypes.flatMap((type) => type.extensions).join(",")}
      label={label}
      help="Select one PDF or drop it here. The document stays on this device."
      multiple={false}
      disabled={busy}
      onFiles={(files) => {
        if (files[0]) void session.setSource(files[0]);
      }}
    />
  );

  const rotateButtons = (
    <div className="rotation-scopes">
      <fieldset>
        <legend>Rotate selected pages</legend>
        <p>{selectedCount} selected</p>
        <div className="rotation-buttons">
          <button
            type="button"
            className="quiet-button"
            disabled={busy || selectedCount === 0}
            onClick={() => session.rotate(false, -90)}
          >
            Rotate selected left
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={busy || selectedCount === 0}
            onClick={() => session.rotate(false, 90)}
          >
            Rotate selected right
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Rotate all pages</legend>
        <p>Applies one quarter turn to every page.</p>
        <div className="rotation-buttons">
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => session.rotate(true, -90)}
          >
            Rotate all left
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => session.rotate(true, 90)}
          >
            Rotate all right
          </button>
        </div>
      </fieldset>
    </div>
  );

  const workspace = snapshot.plan ? (
    <>
      <p className="eyebrow">01 Choose · 02 Rotate · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        Rotate selected pages or the whole PDF
      </h2>
      <p className="small-copy">
        Each action adds a 90° turn relative to the page&apos;s source
        orientation. The preview and requested-change label update together.
      </p>
      {snapshot.error && (
        <p className="organize-error" role="alert">
          {pageToolErrors[snapshot.error]}
        </p>
      )}
      {rotateButtons}
      <div className="organize-toolbar page-tool-actions">
        <button
          className="primary-button"
          type="button"
          disabled={busy || changedCount === 0}
          aria-describedby="rotation-export-guidance"
          onClick={() => void session.export()}
        >
          Export rotated PDF
        </button>
        {choose("Replace PDF")}
        <button
          className="quiet-button"
          type="button"
          disabled={busy}
          onClick={() => void session.reset()}
        >
          Start over
        </button>
      </div>
      <p
        id="rotation-export-guidance"
        className="page-selection-guidance"
        data-blocked={changedCount === 0}
      >
        {changedCount === 0
          ? "Rotate at least one page before exporting."
          : `${changedCount} ${changedCount === 1 ? "page has" : "pages have"} a requested rotation.`}
      </p>
      <PageSelectionGrid
        snapshot={snapshot}
        session={session}
        busy={busy}
        selectionLabel={(page) => `Select source page ${page} for rotation`}
        selectedText="Selected for rotation"
        unselectedText="Not selected for rotation"
        register={registerCanvas}
        details={(page, geometry) => (
          <dl className="rotation-state">
            <div>
              <dt>Requested change</dt>
              <dd>{deltaLabel(page.rotationDelta)}</dd>
            </div>
            {geometry && (
              <div>
                <dt>Effective orientation</dt>
                <dd>
                  {normalizeRotation(
                    geometry.originalRotation + page.rotationDelta,
                  )}
                  °
                </dd>
              </div>
            )}
          </dl>
        )}
      />
      <p className="small-copy organize-limits">
        Current limits: one PDF · {formatBytes(limits.maxFileBytes)} input ·{" "}
        {limits.maxPages} pages · {formatBytes(limits.maxOutputBytes)} output.
        Password-protected PDFs are not supported.
      </p>
    </>
  ) : (
    <>
      <p className="eyebrow">01 Choose · 02 Rotate · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        Choose a PDF to rotate
      </h2>
      {choose()}
      <p className="small-copy organize-limits">
        Current limits: one PDF · {formatBytes(limits.maxFileBytes)} input ·{" "}
        {limits.maxPages} pages. Password-protected PDFs are not supported.
      </p>
    </>
  );

  return (
    <div ref={root} className="organize-workflow page-tool-workflow">
      <p className="visually-hidden" role="status" aria-live="polite">
        {snapshot.announcement}
      </p>
      <ToolShell
        tool={tool}
        state={pageToolState(snapshot)}
        workspace={workspace}
        related={related}
        error={
          <>
            <p className="eyebrow">Choose another PDF</p>
            <h2 tabIndex={-1} data-state-heading>
              This PDF could not be opened
            </h2>
            <p>{pageToolErrors[snapshot.error ?? "PREVIEW_FAILED"]}</p>
            {choose("Choose another PDF")}
            <button
              className="quiet-button"
              type="button"
              onClick={() => void session.reset()}
            >
              Start over
            </button>
          </>
        }
        status={
          <>
            <p className="eyebrow">Working on your device</p>
            <h2 tabIndex={-1} data-state-heading>
              {snapshot.state === "loading"
                ? "Opening your PDF"
                : "Creating your rotated PDF"}
            </h2>
            <p>
              {snapshot.state === "loading"
                ? "Validating the PDF and preparing page previews locally…"
                : snapshot.phase
                  ? pagePhaseCopy[snapshot.phase]
                  : "Pausing previews and starting local export…"}
            </p>
            {snapshot.state === "exporting" && (
              <button
                className="quiet-button"
                type="button"
                onClick={session.cancelExport}
              >
                Cancel export
              </button>
            )}
          </>
        }
        result={
          snapshot.result && (
            <>
              <p className="eyebrow">Ready to save</p>
              <h2 tabIndex={-1} data-state-heading>
                Your rotated PDF is ready
              </h2>
              <p>{snapshot.result.pageCount} validated pages.</p>
              <div className="organize-toolbar">
                <a
                  className="primary-button"
                  href={snapshot.result.url}
                  download="rotated.pdf"
                >
                  Download rotated PDF
                </a>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => void session.reset()}
                >
                  Start over
                </button>
              </div>
            </>
          )
        }
      />
    </div>
  );
}
