"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  COMPRESS_PROFILE_IDS,
  compressPdfInWorker,
  type CompressLimits,
  type CompressPhase,
  type CompressWarning,
} from "@document-platform/pdf-browser/compress";
import type { ToolDefinition } from "@document-platform/tool-registry";
import {
  FilePicker,
  ToolShell,
  type ToolShellState,
} from "@document-platform/ui";
import { formatBytes } from "../merge/session";
import {
  CompressSession,
  compressErrorCopy,
  compressProfileCopy,
  type CompressOutcome,
  type CompressSnapshot,
} from "./session";

const warningCopy: Record<CompressWarning, string> = {
  signatures:
    "This PDF contains a digital signature. Compressing changes the file, so the signature will no longer validate in the compressed copy.",
  pdfa: "This PDF looks like a PDF/A archival file. The compressed copy may no longer meet PDF/A requirements.",
  images_unavailable:
    "This browser could not resize images, so images were left unchanged and only the document data was repacked.",
  layout_unknown:
    "Some images were left unchanged because this PDF's page layout could not be analyzed safely.",
};

const phaseCopy: Record<CompressPhase, string> = {
  reading: "Reading the PDF…",
  images: "Optimizing images…",
  structure: "Repacking document data…",
  saving: "Saving the compressed PDF…",
  verifying: "Checking the compressed PDF…",
};

function toShellState(snapshot: CompressSnapshot): ToolShellState {
  switch (snapshot.state) {
    case "selected":
      return "selected";
    case "processing":
      return "processing";
    case "ready":
      return "result";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function unchangedLines(outcome: CompressOutcome): string[] {
  const lines: string[] = [];
  const { efficient, protected: kept, limits, unreadable } = outcome.unchanged;
  if (efficient)
    lines.push(`${plural(efficient, "image")} already small enough`);
  if (kept)
    lines.push(
      `${plural(kept, "image")} kept unchanged to protect quality (for example screenshots, diagrams, transparency or colour formats that cannot be changed safely)`,
    );
  if (limits)
    lines.push(
      `${plural(limits, "image")} skipped because of size, time or browser limits`,
    );
  if (unreadable)
    lines.push(`${plural(unreadable, "image")} could not be read safely`);
  return lines;
}

export function CompressPdfWorkspace({
  tool,
  limits,
  related,
}: {
  tool: ToolDefinition;
  limits: CompressLimits;
  related: ReactNode;
}) {
  const [session] = useState(
    () => new CompressSession({ compress: compressPdfInWorker, limits }),
  );
  const snapshot = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  );
  const root = useRef<HTMLDivElement>(null);
  const previousState = useRef(snapshot.state);
  const profileName = useId();

  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    if (previousState.current !== snapshot.state) {
      root.current?.querySelector<HTMLElement>("[data-state-heading]")?.focus();
      previousState.current = snapshot.state;
    }
  }, [snapshot.state]);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files[0]) session.choose(files[0]);
    },
    [session],
  );

  const chooser = (label: string) => (
    <FilePicker
      accept={tool.acceptedTypes.flatMap((type) => type.extensions).join(",")}
      label={label}
      help="Select one PDF or drop it here. The document and the compressed copy stay on this device."
      multiple={false}
      disabled={snapshot.state === "processing"}
      onFiles={handleFiles}
    />
  );

  const limitsCopy = (
    <p className="small-copy compress-limits">
      Current limits: one PDF · {formatBytes(limits.maxInputBytes)} input ·{" "}
      {limits.maxPages} pages. Password-protected PDFs are not supported.
    </p>
  );

  const disclosure = (
    <p className="compress-disclosure" role="note">
      Compression changes <strong>images only</strong>: large images are resized
      and saved as JPEG, which loses some detail. Text, fonts, vector drawings
      and page layout are kept as they are. How much smaller the file gets
      depends on what it contains, and some PDFs cannot be reduced.
    </p>
  );

  const workspace =
    snapshot.state === "selected" ? (
      <>
        <p className="eyebrow">01 Choose · 02 Compress · 03 Download</p>
        <h2 tabIndex={-1} data-state-heading>
          Choose how much to compress
        </h2>
        <p className="compress-file">
          <strong>{snapshot.fileName}</strong>
          <span> · {formatBytes(snapshot.inputBytes ?? 0)}</span>
        </p>
        <fieldset className="compress-options">
          <legend>Compression strength</legend>
          {COMPRESS_PROFILE_IDS.map((id) => (
            <label key={id}>
              <input
                type="radio"
                name={profileName}
                value={id}
                checked={snapshot.profile === id}
                onChange={() => session.setProfile(id)}
              />
              <span>
                <strong>{compressProfileCopy[id].label}</strong>
                <small>{compressProfileCopy[id].summary}</small>
                <small>{compressProfileCopy[id].detail}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {disclosure}
        <div className="compress-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void session.start()}
          >
            Compress PDF
          </button>
          <button
            type="button"
            className="quiet-button"
            onClick={() => session.reset()}
          >
            Start over
          </button>
        </div>
        {chooser("Choose a different PDF")}
        {limitsCopy}
      </>
    ) : (
      <>
        <p className="eyebrow">01 Choose · 02 Compress · 03 Download</p>
        <h2 tabIndex={-1} data-state-heading>
          Choose a PDF to compress
        </h2>
        {disclosure}
        {chooser("Choose a PDF to compress")}
        {limitsCopy}
      </>
    );

  const progress = snapshot.progress;
  const status = (
    <>
      <p className="eyebrow">Working on your device</p>
      <h2 tabIndex={-1} data-state-heading>
        Compressing your PDF
      </h2>
      <p>
        {progress
          ? progress.phase === "images" && progress.total
            ? `Optimizing images — ${Math.min(progress.done ?? 0, progress.total)} of ${progress.total} checked…`
            : phaseCopy[progress.phase]
          : "Preparing…"}
      </p>
      <p className="small-copy">
        Large files can take a minute. Nothing leaves this device.
      </p>
      <button
        type="button"
        className="quiet-button"
        onClick={() => session.cancel()}
      >
        Cancel
      </button>
    </>
  );

  const outcome = snapshot.outcome;
  const profileLabel = compressProfileCopy[snapshot.profile].label;
  let resultNode: ReactNode = null;
  if (outcome) {
    const warnings = outcome.warnings.map((warning) => (
      <li key={warning}>{warningCopy[warning]}</li>
    ));
    const lines = unchangedLines(outcome);
    if (outcome.kind === "reduced") {
      resultNode = (
        <div className="compress-result">
          <p className="eyebrow">Ready to save</p>
          <h2 tabIndex={-1} data-state-heading>
            Compressed PDF ready
          </h2>
          <p className="compress-saving">
            <strong>{outcome.savedPercent}% smaller</strong>
            <span>
              {" "}
              · {formatBytes(outcome.inputBytes)} →{" "}
              {formatBytes(outcome.outputBytes)}
            </span>
          </p>
          <dl className="compress-stats">
            <div>
              <dt>Original size</dt>
              <dd>{formatBytes(outcome.inputBytes)}</dd>
            </div>
            <div>
              <dt>New size</dt>
              <dd>{formatBytes(outcome.outputBytes)}</dd>
            </div>
            <div>
              <dt>Pages</dt>
              <dd>{outcome.pageCount}</dd>
            </div>
            <div>
              <dt>Strength</dt>
              <dd>{profileLabel}</dd>
            </div>
          </dl>
          <p className="compress-changes">
            {outcome.imagesOptimized > 0 ? (
              <>
                <strong>
                  {outcome.imagesOptimized} of{" "}
                  {plural(outcome.imagesFound, "image")} resized or re-saved.
                </strong>{" "}
                {compressProfileCopy[snapshot.profile].detail} Text, fonts and
                vector drawings were not changed.
              </>
            ) : (
              <>
                <strong>No images were changed.</strong> The saving comes from
                repacking the document&rsquo;s data without any loss of quality.
              </>
            )}
          </p>
          {lines.length > 0 && (
            <ul className="compress-unchanged">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="compress-warnings" role="note">
              {warnings}
            </ul>
          )}
          <div className="compress-actions">
            {outcome.url && (
              <a
                className="primary-button"
                href={outcome.url}
                download={outcome.fileName}
              >
                Download compressed PDF
              </a>
            )}
            <button
              type="button"
              className="quiet-button"
              onClick={() => session.tryAnotherStrength()}
            >
              Try a different strength
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => session.reset()}
            >
              Compress another PDF
            </button>
          </div>
        </div>
      );
    } else {
      resultNode = (
        <div className="compress-result">
          <p className="eyebrow">No file created</p>
          <h2 tabIndex={-1} data-state-heading>
            This PDF could not be made smaller
          </h2>
          <p>
            At {profileLabel} strength this PDF could not be made meaningfully
            smaller than its original {formatBytes(outcome.inputBytes)}, so no
            compressed file was created. Your original is unchanged.
          </p>
          {lines.length > 0 ? (
            <>
              <p className="small-copy">Left unchanged:</p>
              <ul className="compress-unchanged">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="small-copy">
              It may already be well optimized, or it may contain mostly text
              and vector content.
            </p>
          )}
          {snapshot.profile !== "strong" && (
            <p className="small-copy">
              A stronger setting may save more, at the cost of image detail.
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="compress-warnings" role="note">
              {warnings}
            </ul>
          )}
          <div className="compress-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => session.tryAnotherStrength()}
            >
              Try a different strength
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => session.reset()}
            >
              Choose another PDF
            </button>
          </div>
        </div>
      );
    }
  }

  const errorNode = (
    <>
      <p className="eyebrow">Choose another PDF</p>
      <h2 tabIndex={-1} data-state-heading>
        This PDF could not be compressed
      </h2>
      <p>
        {snapshot.error
          ? compressErrorCopy[snapshot.error]
          : "An error occurred."}
      </p>
      {chooser("Choose another PDF")}
    </>
  );

  return (
    <div ref={root} className="compress-workflow">
      <p className="visually-hidden" role="status" aria-live="polite">
        {snapshot.announcement}
      </p>
      <ToolShell
        tool={tool}
        state={toShellState(snapshot)}
        workspace={workspace}
        status={status}
        result={resultNode}
        error={errorNode}
        related={related}
      />
    </div>
  );
}
