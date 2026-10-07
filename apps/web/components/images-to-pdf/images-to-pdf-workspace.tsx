"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ImageLimits } from "@document-platform/pdf-browser/image-types";
import type { ToolDefinition } from "@document-platform/tool-registry";
import { FilePicker, ReorderControls, ToolShell } from "@document-platform/ui";
import {
  formatImageBytes,
  imageErrorCopy,
  ImagesToPdfSession,
  safeImageName,
} from "./session";

const phaseCopy = {
  reading: "Checking the selected images locally…",
  generating: "Placing each image onto its PDF page in order…",
  validating: "Reopening and validating the generated PDF…",
} as const;

export function ImagesToPdfWorkspace({
  tool,
  limits,
  related,
}: {
  tool: ToolDefinition;
  limits: ImageLimits;
  related: ReactNode;
}) {
  const [session] = useState(() => new ImagesToPdfSession(limits));
  const current = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const root = useRef<HTMLDivElement>(null);
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
      root.current?.querySelector<HTMLElement>("[data-state-heading]")?.focus();
      previousState.current = current.state;
    }
  }, [current.state]);

  const busy = current.state === "generating";
  const loading = current.state === "loading";
  const firstError =
    current.error ?? current.rows.find((row) => row.error)?.error;

  const picker = (label: string) => (
    <FilePicker
      accept={tool.acceptedTypes.flatMap((type) => type.extensions).join(",")}
      label={label}
      help="Choose JPEG or PNG images, or drop them here. Image data stays on this device."
      disabled={busy || loading || current.state === "result"}
      onFiles={(files) => void session.add(files)}
    />
  );

  function remove(id: string, index: number) {
    session.remove(id);
    requestAnimationFrame(() => {
      const rows = root.current?.querySelectorAll<HTMLElement>(".image-card");
      const next =
        rows?.[
          Math.min(index, Math.max(0, (rows?.length ?? 1) - 1))
        ]?.querySelector<HTMLButtonElement>("button");
      (
        next ??
        root.current?.querySelector<HTMLButtonElement>(".file-picker button")
      )?.focus();
    });
  }

  const workspace = (
    <>
      <p className="eyebrow">
        01 Choose · 02 Arrange · 03 Set layout · 04 Download
      </p>
      <h2 tabIndex={-1} data-state-heading>
        {current.rows.length
          ? "Arrange your images"
          : "Build a PDF from images"}
      </h2>
      <p className="small-copy">
        Each image becomes one page. JPEG and PNG are supported. Images are
        checked and processed locally.
      </p>
      {firstError && (
        <p className="organize-error" role="alert">
          {imageErrorCopy[firstError]}
        </p>
      )}
      {current.rows.length === 0
        ? picker("Choose images")
        : picker("Add more images")}

      {current.rows.length > 0 && (
        <>
          <p className="selection-summary">
            {current.rows.length}{" "}
            {current.rows.length === 1 ? "image" : "images"} ·{" "}
            {formatImageBytes(
              current.rows.reduce((sum, row) => sum + row.file.size, 0),
            )}
          </p>
          <ol className="image-grid" aria-label="Selected image order">
            {current.rows.map((row, index) => (
              <li
                key={row.id}
                className="image-card"
                data-image-id={row.id}
                data-position={index + 1}
              >
                <div className="image-card__preview">
                  {row.previewUrl ? (
                    // Blob URLs are local session resources owned by the session.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.previewUrl}
                      alt={`Preview of image ${index + 1}: ${safeImageName(row.file.name)}`}
                    />
                  ) : (
                    <p role={row.status === "loading" ? "status" : undefined}>
                      {row.status === "loading"
                        ? "Preparing preview…"
                        : "Preview unavailable"}
                    </p>
                  )}
                </div>
                <p className="image-card__position">
                  Page {index + 1} of {current.rows.length}
                </p>
                <strong>{safeImageName(row.file.name)}</strong>
                <p className="small-copy">
                  {row.inspection
                    ? `${row.inspection.displayWidth} × ${row.inspection.displayHeight} px · ${formatImageBytes(row.file.size)}`
                    : formatImageBytes(row.file.size)}
                </p>
                {row.error && (
                  <p className="image-card__error">
                    {imageErrorCopy[row.error]}
                  </p>
                )}
                <div className="image-card__actions">
                  <ReorderControls
                    pageNumber={index + 1}
                    itemLabel={`image ${index + 1}`}
                    canMoveEarlier={!busy && !loading && index > 0}
                    canMoveLater={
                      !busy && !loading && index < current.rows.length - 1
                    }
                    onMove={(direction) => session.move(row.id, direction)}
                  />
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={busy}
                    aria-label={`Remove image ${index + 1}: ${safeImageName(row.file.name)}`}
                    onClick={() => remove(row.id, index)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <div className="image-layout-options">
            <fieldset disabled={busy}>
              <legend>Page size</legend>
              {(["auto", "a4", "letter"] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="page-size"
                    value={value}
                    checked={current.pageSize === value}
                    onChange={() => session.setOptions({ pageSize: value })}
                  />
                  {value === "auto" ? "Auto" : value === "a4" ? "A4" : "Letter"}
                </label>
              ))}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Image fit</legend>
              <label>
                <input
                  type="radio"
                  name="image-fit"
                  value="contain"
                  checked={current.fit === "contain"}
                  onChange={() => session.setOptions({ fit: "contain" })}
                />
                Contain — show the entire image
              </label>
              <label>
                <input
                  type="radio"
                  name="image-fit"
                  value="cover"
                  checked={current.fit === "cover"}
                  aria-describedby="cover-warning"
                  onChange={() => session.setOptions({ fit: "cover" })}
                />
                Cover — fill the page
              </label>
              <p id="cover-warning" className="small-copy">
                Cover preserves proportions but may crop image edges.
              </p>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Page orientation</legend>
              {(["auto", "portrait", "landscape"] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="page-orientation"
                    value={value}
                    checked={current.orientation === value}
                    onChange={() => session.setOptions({ orientation: value })}
                  />
                  {value[0].toUpperCase() + value.slice(1)}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="merge-actions image-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!session.canGenerate()}
              onClick={() => void session.generate()}
            >
              Create PDF
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={session.reset}
            >
              Start over
            </button>
          </div>
        </>
      )}
      <p className="small-copy organize-limits">
        Current engineering limits: {limits.maxFiles} images ·{" "}
        {formatImageBytes(limits.maxFileBytes)} each ·{" "}
        {formatImageBytes(limits.maxTotalBytes)} combined · up to{" "}
        {limits.maxPixelsPerImage.toLocaleString()} pixels per image.
        Transparent PNG areas are placed on white PDF pages.
      </p>
    </>
  );

  const shellState =
    current.state === "generating" || current.state === "loading"
      ? "processing"
      : current.state === "result"
        ? "result"
        : current.rows.length
          ? "selected"
          : "idle";

  return (
    <div ref={root} className="images-to-pdf-workflow">
      <p className="visually-hidden" role="status" aria-live="polite">
        {current.announcement}
      </p>
      <ToolShell
        tool={tool}
        state={shellState}
        workspace={workspace}
        related={related}
        status={
          <>
            <p className="eyebrow">Working on your device</p>
            <h2 tabIndex={-1} data-state-heading>
              {loading ? "Preparing image previews" : "Creating your PDF"}
            </h2>
            <p>
              {loading
                ? "Images are being checked and reduced local previews are being prepared one at a time…"
                : current.phase
                  ? phaseCopy[current.phase]
                  : "Starting the local PDF worker…"}
            </p>
            {busy && (
              <button
                type="button"
                className="quiet-button"
                onClick={() => session.cancel()}
              >
                Cancel generation
              </button>
            )}
          </>
        }
        result={
          current.result && (
            <>
              <p className="eyebrow">Ready to save</p>
              <h2 tabIndex={-1} data-state-heading>
                Your image PDF is ready
              </h2>
              <p>
                {current.result.pageCount} validated{" "}
                {current.result.pageCount === 1 ? "page" : "pages"} ·{" "}
                {formatImageBytes(current.result.outputBytes)}
              </p>
              <div className="merge-actions">
                <a
                  className="primary-button"
                  href={current.result.url}
                  download="images-to-pdf.pdf"
                >
                  Download PDF
                </a>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={session.reset}
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
