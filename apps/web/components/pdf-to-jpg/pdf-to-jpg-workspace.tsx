"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type {
  PdfJpegDpi,
  PdfToJpegLimits,
} from "@document-platform/pdf-browser/pdf-to-jpg";
import type { ToolDefinition } from "@document-platform/tool-registry";
import { FilePicker, ToolShell } from "@document-platform/ui";
import { formatBytes } from "../merge/session";
import { usePagePreview } from "../pdf-preview/use-page-preview";
import { pageToolErrors, pageToolState } from "../page-tools/copy";
import { PageSelectionGrid } from "../page-tools/page-selection-grid";

type SelectionMode = "all" | "selected";
const dpiOptions: readonly {
  value: PdfJpegDpi;
  label: string;
  copy: string;
}[] = [
  { value: 96, label: "96 DPI", copy: "Smaller images for screen use" },
  { value: 150, label: "150 DPI", copy: "Balanced size and detail" },
  {
    value: 300,
    label: "300 DPI",
    copy: "High resolution; lower page limits may apply",
  },
];

const jpegErrors = {
  ...pageToolErrors,
  INVALID_PLAN: "Select at least one valid page to create JPG images.",
  OUTPUT_LIMIT:
    "This page and resolution combination exceeds the current image limits. Select fewer pages or a lower resolution.",
  OUTPUT_INVALID:
    "One or more JPG images could not be validated. No download was created.",
  OPERATION_FAILED:
    "The JPG images could not be created. Try again with another PDF or a lower resolution.",
  RENDER_FAILED:
    "A page could not be rendered as a JPG. No partial download was created.",
} as const;

export function PdfToJpgWorkspace({
  tool,
  limits,
  related,
}: {
  tool: ToolDefinition;
  limits: PdfToJpegLimits;
  related: ReactNode;
}) {
  const { snapshot, session, registerCanvas } = usePagePreview({
    maxInputBytes: tool.limits!.maxFileBytes,
    maxPages: tool.limits!.maxPages,
    maxOutputBytes: tool.limits!.maxOutputBytes,
  });
  const [mode, setMode] = useState<SelectionMode>("all");
  const [dpi, setDpi] = useState<PdfJpegDpi>(150);
  const root = useRef<HTMLDivElement>(null);
  const previousState = useRef(snapshot.state);
  const modeName = useId();
  const dpiName = useId();

  useEffect(() => {
    if (
      mode === "all" &&
      snapshot.plan &&
      snapshot.selected.length !== snapshot.plan.pages.length &&
      snapshot.state !== "exporting"
    )
      session.selectAll();
  }, [mode, session, snapshot.plan, snapshot.selected.length, snapshot.state]);
  useEffect(() => {
    if (previousState.current !== snapshot.state) {
      root.current?.querySelector<HTMLElement>("[data-state-heading]")?.focus();
      previousState.current = snapshot.state;
    }
  }, [snapshot.state]);

  const busy = snapshot.state === "exporting";
  const selectedCount = snapshot.selected.length;
  const requestedCount =
    mode === "all" ? (snapshot.plan?.pages.length ?? 0) : selectedCount;
  const blocked =
    requestedCount < 1 || requestedCount > limits.maxSelectedPages;

  const choose = (label = "Choose PDF") => (
    <FilePicker
      accept={tool.acceptedTypes.flatMap((type) => type.extensions).join(",")}
      label={label}
      help="Select one PDF or drop it here. The document and generated images stay on this device."
      multiple={false}
      disabled={busy}
      onFiles={(files) => {
        if (files[0]) {
          setMode("all");
          setDpi(150);
          void session.setSource(files[0]);
        }
      }}
    />
  );

  const workspace = snapshot.plan ? (
    <>
      <p className="eyebrow">01 Choose · 02 Select · 03 Render · 04 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        Choose pages and resolution
      </h2>
      <p className="small-copy">
        JPG filenames and ZIP order always follow the source PDF page order.
      </p>
      {snapshot.error && (
        <p className="organize-error" role="alert">
          {jpegErrors[snapshot.error]}
        </p>
      )}
      <div className="pdf-jpg-options">
        <fieldset disabled={busy} aria-describedby={`${modeName}-help`}>
          <legend>Pages to convert</legend>
          <label>
            <input
              type="radio"
              name={modeName}
              value="all"
              checked={mode === "all"}
              onChange={() => setMode("all")}
            />
            <span>
              <strong>All pages</strong>
              <small>Convert every page in source order</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name={modeName}
              value="selected"
              checked={mode === "selected"}
              onChange={() => {
                setMode("selected");
                session.clearSelection();
              }}
            />
            <span>
              <strong>Selected pages</strong>
              <small>Choose specific pages below</small>
            </span>
          </label>
          <p id={`${modeName}-help`} className="small-copy">
            Up to {limits.maxSelectedPages} pages can be generated in one
            request.
          </p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Output resolution</legend>
          {dpiOptions.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name={dpiName}
                value={option.value}
                checked={dpi === option.value}
                onChange={() => setDpi(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.copy}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      <p className="page-selection-guidance" role="status">
        {requestedCount > limits.maxSelectedPages
          ? `Select no more than ${limits.maxSelectedPages} pages.`
          : mode === "all"
            ? `All ${requestedCount} pages will be converted at ${dpi} DPI.`
            : requestedCount
              ? `${requestedCount} ${requestedCount === 1 ? "page" : "pages"} will be converted at ${dpi} DPI in source order.`
              : "Select at least one page to convert."}
      </p>
      <PageSelectionGrid
        snapshot={snapshot}
        session={session}
        busy={busy || mode === "all"}
        selectionLabel={(page) => `Select source page ${page} for JPG export`}
        selectedText={
          mode === "all" ? "Included in all pages" : "Selected for JPG export"
        }
        unselectedText="Not selected for JPG export"
        register={registerCanvas}
        details={(page, geometry) =>
          geometry ? (
            <p className="page-geometry">
              {Math.round((geometry.width * dpi) / 72)} ×{" "}
              {Math.round((geometry.height * dpi) / 72)} px
            </p>
          ) : null
        }
      />
      <div className="organize-toolbar page-tool-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy || blocked}
          onClick={() =>
            void session.exportJpeg(
              mode === "all" ? "all" : snapshot.selected,
              dpi,
              limits,
            )
          }
        >
          Create JPG images
        </button>
        {choose("Replace PDF")}
        <button
          type="button"
          className="quiet-button"
          disabled={busy}
          onClick={() => void session.reset()}
        >
          Start over
        </button>
      </div>
      <p className="small-copy organize-limits">
        Current engineering limits: one PDF ·{" "}
        {formatBytes(tool.limits!.maxFileBytes)} input · {tool.limits!.maxPages}{" "}
        preview pages · {limits.maxSelectedPages} generated pages ·{" "}
        {Math.round(limits.maxPixelsPerPage / 1_000_000)} megapixels per page ·{" "}
        {formatBytes(limits.maxCombinedOutputBytes)} combined JPGs.
        Password-protected PDFs are not supported.
      </p>
    </>
  ) : (
    <>
      <p className="eyebrow">01 Choose · 02 Select · 03 Render · 04 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        Choose a PDF to turn into JPG images
      </h2>
      {choose()}
      <p className="small-copy organize-limits">
        Current limits: one PDF · {formatBytes(tool.limits!.maxFileBytes)} input
        · {tool.limits!.maxPages} pages. Password-protected PDFs are not
        supported.
      </p>
    </>
  );

  const result = snapshot.result;
  const progress = snapshot.progress;
  return (
    <div ref={root} className="organize-workflow pdf-jpg-workflow">
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
            <p>{jpegErrors[snapshot.error ?? "PREVIEW_FAILED"]}</p>
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
                : "Creating JPG images"}
            </h2>
            <p>
              {snapshot.state === "loading"
                ? "Validating the PDF and preparing page previews locally…"
                : snapshot.jpegPhase === "archiving"
                  ? "Packaging all validated JPG images into one ZIP…"
                  : progress?.total
                    ? `${snapshot.jpegPhase === "validating" ? "Validating image" : "Rendering page"} ${progress.current} of ${progress.total}`
                    : "Pausing previews and preparing local rendering…"}
            </p>
            {snapshot.state === "exporting" && (
              <button
                className="quiet-button"
                type="button"
                onClick={session.cancelExport}
              >
                Cancel generation
              </button>
            )}
          </>
        }
        result={
          result &&
          (result.kind === "jpg" || result.kind === "zip") && (
            <>
              <p className="eyebrow">Ready to save</p>
              <h2 tabIndex={-1} data-state-heading>
                {result.kind === "jpg"
                  ? "Your JPG is ready"
                  : "Your JPG ZIP is ready"}
              </h2>
              <p>
                {result.fileCount} validated{" "}
                {result.fileCount === 1 ? "image" : "images"} at {result.dpi}{" "}
                DPI
                {result.combinedJpegBytes
                  ? ` · ${formatBytes(result.combinedJpegBytes)} combined JPG data`
                  : ""}
              </p>
              <div className="organize-toolbar">
                <a
                  className="primary-button"
                  href={result.url}
                  download={
                    result.kind === "jpg"
                      ? (result.pages?.[0]?.filename ?? "page-001.jpg")
                      : "pdf-pages-jpg.zip"
                  }
                >
                  {result.kind === "jpg" ? "Download JPG" : "Download ZIP"}
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
