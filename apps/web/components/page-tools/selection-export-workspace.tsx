"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ToolDefinition } from "@document-platform/tool-registry";
import { FilePicker, ToolShell } from "@document-platform/ui";
import { formatBytes } from "../merge/session";
import { usePagePreview } from "../pdf-preview/use-page-preview";
import { pagePhaseCopy, pageToolErrors, pageToolState } from "./copy";
import { PageSelectionGrid } from "./page-selection-grid";

const modes = {
  extract: {
    chooseHeading: "Choose a PDF to extract pages from",
    readyHeading: "Choose pages to extract",
    readyCopy:
      "The new PDF follows the current page order, regardless of the order in which you select pages.",
    selectionLabel: (page: number) =>
      `Select source page ${page} for extraction`,
    selectedText: "Selected for extraction",
    unselectedText: "Not selected for extraction",
    action: "Export selected pages",
    empty: "Select at least one page to create the extracted PDF.",
    exporting: "Creating your extracted PDF",
    resultHeading: "Your extracted PDF is ready",
    download: "Download extracted pages",
    filename: "extracted-pages.pdf",
  },
  delete: {
    chooseHeading: "Choose a PDF to remove pages from",
    readyHeading: "Mark pages for removal",
    readyCopy:
      "Marked pages are excluded. Every retained page stays in its original relative order.",
    selectionLabel: (page: number) => `Mark source page ${page} for removal`,
    selectedText: "Marked for removal",
    unselectedText: "Will be retained",
    action: "Export remaining pages",
    empty: "Mark at least one page to remove.",
    exporting: "Creating the PDF with pages removed",
    resultHeading: "Your PDF with pages removed is ready",
    download: "Download remaining pages",
    filename: "pages-removed.pdf",
  },
} as const;

export function SelectionExportWorkspace({
  tool,
  mode,
  related,
}: {
  tool: ToolDefinition;
  mode: keyof typeof modes;
  related: ReactNode;
}) {
  const copy = modes[mode];
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
  const pageCount = snapshot.plan?.pages.length ?? 0;
  const allSelected = selectedCount > 0 && selectedCount === pageCount;
  const blocked = selectedCount === 0 || (mode === "delete" && allSelected);
  const guidance =
    mode === "delete" && allSelected
      ? "At least one page must remain. Clear one removal mark before exporting."
      : copy.empty;
  const guidanceId = `${mode}-selection-guidance`;

  const choose = (label = "Choose PDF") => (
    <FilePicker
      accept={tool.acceptedTypes.flatMap((type) => type.extensions).join(",")}
      label={label}
      help="Select one PDF or drop it here. The document stays on this device."
      multiple={false}
      disabled={snapshot.state === "exporting"}
      onFiles={(files) => {
        if (files[0]) void session.setSource(files[0]);
      }}
    />
  );

  const workspace = snapshot.plan ? (
    <>
      <p className="eyebrow">01 Choose · 02 Select · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        {copy.readyHeading}
      </h2>
      <p className="small-copy">{copy.readyCopy}</p>
      {snapshot.error && (
        <p className="organize-error" role="alert">
          {pageToolErrors[snapshot.error]}
        </p>
      )}
      <div className="organize-toolbar page-tool-actions">
        <button
          className="primary-button"
          type="button"
          disabled={snapshot.state === "exporting" || blocked}
          aria-describedby={guidanceId}
          onClick={() =>
            void (mode === "extract"
              ? session.exportExtracted()
              : session.exportRemaining())
          }
        >
          {copy.action}
        </button>
        {choose("Replace PDF")}
        <button
          className="quiet-button"
          type="button"
          disabled={snapshot.state === "exporting"}
          onClick={() => void session.reset()}
        >
          Start over
        </button>
      </div>
      <p
        id={guidanceId}
        className="page-selection-guidance"
        data-blocked={blocked}
      >
        {blocked
          ? guidance
          : mode === "extract"
            ? `${selectedCount} ${selectedCount === 1 ? "page" : "pages"} will be extracted in displayed order.`
            : `${selectedCount} ${selectedCount === 1 ? "page is" : "pages are"} marked; ${pageCount - selectedCount} will remain.`}
      </p>
      <PageSelectionGrid
        snapshot={snapshot}
        session={session}
        busy={snapshot.state === "exporting"}
        selectionLabel={copy.selectionLabel}
        selectedText={copy.selectedText}
        unselectedText={copy.unselectedText}
        register={registerCanvas}
      />
      <p className="small-copy organize-limits">
        Current limits: one PDF · {formatBytes(limits.maxFileBytes)} input ·{" "}
        {limits.maxPages} pages · {formatBytes(limits.maxOutputBytes)} output.
        Password-protected PDFs are not supported.
      </p>
    </>
  ) : (
    <>
      <p className="eyebrow">01 Choose · 02 Select · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        {copy.chooseHeading}
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
                : copy.exporting}
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
                {copy.resultHeading}
              </h2>
              <p>{snapshot.result.pageCount} validated pages.</p>
              <div className="organize-toolbar">
                <a
                  className="primary-button"
                  href={snapshot.result.url}
                  download={copy.filename}
                >
                  {copy.download}
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
