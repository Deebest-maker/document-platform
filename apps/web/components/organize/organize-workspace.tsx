"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { PageReference } from "@document-platform/pdf-browser/page-model";
import type { PageErrorCode } from "@document-platform/pdf-browser/pages";
import type { ToolDefinition } from "@document-platform/tool-registry";
import {
  FilePicker,
  PageThumbnail,
  ReorderControls,
  ToolShell,
  type ToolShellState,
} from "@document-platform/ui";
import { formatBytes } from "../merge/session";
import { usePagePreview } from "../pdf-preview/use-page-preview";
import type {
  PageSnapshot,
  PreviewSession,
} from "../pdf-preview/preview-session";

const errors: Record<PageErrorCode, string> = {
  INVALID_PLAN: "That page order is not valid. Review the pages and try again.",
  INPUT_LIMIT: "Choose one PDF within the current size limit.",
  INVALID_PDF: "This PDF is damaged or unsupported. Choose another PDF.",
  ENCRYPTED_PDF:
    "Password-protected PDFs are not supported. Choose an unencrypted copy.",
  PAGE_LIMIT: "This PDF exceeds the current page limit.",
  OUTPUT_LIMIT: "The organized PDF exceeds the current output limit.",
  OUTPUT_INVALID: "The result could not be validated. No download was created.",
  OPERATION_FAILED:
    "The organized PDF could not be created. Try again with another file.",
  PREVIEW_FAILED: "The PDF preview could not open. Choose another PDF.",
  RENDER_FAILED: "A page preview could not be rendered.",
  CANCELLED: "Export cancelled. Your page order is still available.",
  WORKER_UNAVAILABLE:
    "This browser could not start local PDF processing. Try an up-to-date browser.",
};

const phaseCopy = {
  reading: "Reading the source PDF locally…",
  transforming: "Writing pages in the displayed order…",
  validating: "Reopening and validating the organized PDF…",
};

function stateFor(snapshot: PageSnapshot): ToolShellState {
  if (snapshot.state === "empty") return "idle";
  if (snapshot.state === "loading" || snapshot.state === "exporting")
    return "processing";
  if (snapshot.state === "result") return "result";
  if (snapshot.state === "error") return "error";
  return "selected";
}

function PageItem({
  page,
  index,
  count,
  busy,
  snapshot,
  session,
  register,
}: {
  page: PageReference;
  index: number;
  count: number;
  busy: boolean;
  snapshot: PageSnapshot;
  session: PreviewSession;
  register: (id: string, canvas: HTMLCanvasElement | null) => void;
}) {
  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => register(page.id, canvas),
    [page.id, register],
  );
  return (
    <li
      data-page-id={page.id}
      data-source-page={page.sourcePageNumber}
      aria-posinset={index + 1}
      aria-setsize={count}
    >
      <PageThumbnail
        pageNumber={page.sourcePageNumber}
        disabled={busy}
        status={snapshot.thumbnails[page.id] ?? "idle"}
        rotation={page.rotationDelta}
        canvasRef={canvasRef}
      >
        <p className="page-position">
          Position {index + 1} of {count}
        </p>
        <ReorderControls
          pageNumber={page.sourcePageNumber}
          canMoveEarlier={!busy && index > 0}
          canMoveLater={!busy && index < count - 1}
          onMove={(direction) => session.move(page.id, direction)}
        />
      </PageThumbnail>
    </li>
  );
}

export function OrganizeWorkspace({
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
      <p className="eyebrow">01 Choose · 02 Reorder · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        Arrange your pages
      </h2>
      <p className="small-copy">
        Move pages earlier or later. The numbered positions below are the exact
        order used in the exported PDF.
      </p>
      {snapshot.error && (
        <p className="organize-error" role="alert">
          {errors[snapshot.error]}
        </p>
      )}
      <div className="organize-toolbar">
        <button
          className="primary-button"
          type="button"
          disabled={snapshot.state === "exporting"}
          onClick={() => void session.export()}
        >
          Export organized PDF
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
      <p className="small-copy organize-limits">
        Current limits: one PDF · {formatBytes(limits.maxFileBytes)} input ·{" "}
        {limits.maxPages} pages · {formatBytes(limits.maxOutputBytes)} output.
        Password-protected PDFs are not supported.
      </p>
      <ol className="organize-grid" aria-label="Organized page order">
        {snapshot.plan.pages.map((page, index) => (
          <PageItem
            key={page.id}
            page={page}
            index={index}
            count={snapshot.plan!.pages.length}
            busy={snapshot.state === "exporting"}
            snapshot={snapshot}
            session={session}
            register={registerCanvas}
          />
        ))}
      </ol>
    </>
  ) : (
    <>
      <p className="eyebrow">01 Choose · 02 Reorder · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        Choose a PDF to organize
      </h2>
      {choose()}
      <p className="small-copy organize-limits">
        Current limits: one PDF · {formatBytes(limits.maxFileBytes)} input ·{" "}
        {limits.maxPages} pages. Password-protected PDFs are not supported.
      </p>
    </>
  );

  const error = (
    <>
      <p className="eyebrow">Choose another PDF</p>
      <h2 tabIndex={-1} data-state-heading>
        This PDF could not be opened
      </h2>
      <p>{errors[snapshot.error ?? "PREVIEW_FAILED"]}</p>
      {choose("Choose another PDF")}
      <button
        className="quiet-button"
        type="button"
        onClick={() => void session.reset()}
      >
        Start over
      </button>
    </>
  );

  return (
    <div ref={root} className="organize-workflow">
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {snapshot.announcement}
      </p>
      <ToolShell
        tool={tool}
        state={stateFor(snapshot)}
        workspace={workspace}
        error={error}
        related={related}
        status={
          <>
            <p className="eyebrow">Working on your device</p>
            <h2 tabIndex={-1} data-state-heading>
              {snapshot.state === "loading"
                ? "Opening your PDF"
                : "Creating your organized PDF"}
            </h2>
            <p>
              {snapshot.state === "loading"
                ? "Validating the PDF and preparing page previews locally…"
                : snapshot.phase
                  ? phaseCopy[snapshot.phase]
                  : "Pausing previews and starting local export…"}
            </p>
            <p className="small-copy">
              Keep this page open. Your PDF is not being uploaded.
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
                Your organized PDF is ready
              </h2>
              <p>{snapshot.result.pageCount} pages in the displayed order.</p>
              <div className="organize-toolbar">
                <a
                  className="primary-button"
                  href={snapshot.result.url}
                  download="organized.pdf"
                >
                  Download organized PDF
                </a>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => void session.reset()}
                >
                  Start over
                </button>
              </div>
              <p className="small-copy">
                The download remains available until you start over or leave
                this page. Keep the original PDF; document-level forms,
                bookmarks and signatures may not be retained.
              </p>
            </>
          )
        }
      />
    </div>
  );
}
