"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { MetadataRemovalLimits } from "@document-platform/pdf-browser/metadata-removal";
import { removePdfMetadata } from "@document-platform/pdf-browser/metadata-removal";
import type { ToolDefinition } from "@document-platform/tool-registry";
import {
  FilePicker,
  ToolShell,
  type ToolShellState,
} from "@document-platform/ui";
import {
  RemoveMetadataSession,
  removeMetadataErrorCopy,
  type RemoveMetadataSnapshot,
} from "./session";

function formatBytes(bytes: number | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatList(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function pluralise(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function toToolShellState(snapshot: RemoveMetadataSnapshot): ToolShellState {
  switch (snapshot.state) {
    case "loading":
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

export function RemovePdfMetadataWorkspace({
  tool,
  limits,
  related,
}: {
  tool: ToolDefinition;
  limits: MetadataRemovalLimits;
  related: ReactNode;
}) {
  const [session] = useState(
    () =>
      new RemoveMetadataSession({
        removeMetadata: removePdfMetadata,
        limits,
      }),
  );
  const snapshot = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  );
  const announcementId = useId();

  useEffect(() => {
    return () => {
      session.dispose();
    };
  }, [session]);

  const handleFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      void session.run(file);
    },
    [session],
  );

  const removedSummary = useMemo(
    () => buildRemovedSummary(snapshot),
    [snapshot],
  );
  const beforeAfter = useMemo(() => buildBeforeAfter(snapshot), [snapshot]);

  const chooser = (label: string) => (
    <FilePicker
      accept={tool.acceptedTypes.flatMap((type) => type.extensions).join(",")}
      label={label}
      help="Select one PDF or drop it here. The document and the cleaned output stay on this device."
      multiple={false}
      disabled={snapshot.state === "loading" || snapshot.state === "processing"}
      onFiles={handleFiles}
    />
  );

  const workspace = (
    <>
      <p className="eyebrow">01 Choose · 02 Clean · 03 Verify · 04 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        Choose a PDF to clean
      </h2>
      <p className="remove-metadata-disclosure" role="note">
        This tool removes supported metadata (Document Information fields, the
        XMP metadata stream, and — where this build is able — the trailer
        identifier). It is <strong>not</strong> secure redaction: text and
        images on each page are preserved as-is. Content embedded in the pages
        themselves is not touched.
      </p>
      {chooser("Choose a PDF to clean")}
      <p className="small-copy">
        Current limits: one PDF · {formatBytes(limits.maxInputBytes)} input ·{" "}
        {limits.maxPages} pages · {formatBytes(limits.maxOutputBytes)} output.
        Password-protected PDFs are not supported.
      </p>
    </>
  );

  const status = (
    <>
      <p className="eyebrow">Working on your device</p>
      <h2 tabIndex={-1} data-state-heading>
        {snapshot.state === "loading" ? "Preparing" : "Removing metadata"}
      </h2>
      <p>
        {snapshot.progress?.phase === "reading"
          ? "Reading the PDF…"
          : snapshot.progress?.phase === "removing"
            ? "Removing supported metadata fields…"
            : snapshot.progress?.phase === "validating"
              ? "Saving the cleaned PDF…"
              : snapshot.progress?.phase === "verifying"
                ? "Verifying the cleaned PDF…"
                : "Preparing the PDF locally…"}
      </p>
    </>
  );

  const resultNode =
    snapshot.state === "ready" ? (
      <div className="remove-metadata-result">
        <p className="eyebrow">Ready to save</p>
        <h2 tabIndex={-1} data-state-heading>
          Cleaned PDF ready
        </h2>
        <p className="remove-metadata-result-summary">{removedSummary}</p>
        {snapshot.trailerIdControllable === false ? (
          <p className="remove-metadata-trailer-note" role="note">
            This build was not able to suppress the trailer identifier for this
            PDF. The cleaned file still contains a trailer /ID. See the privacy
            page for details.
          </p>
        ) : null}
        {snapshot.pagesPreserved === false ? (
          <p className="remove-metadata-geometry-note" role="note">
            Page geometry changed during save. The file was still produced, but
            verify before use.
          </p>
        ) : null}
        <dl className="remove-metadata-stats">
          <div>
            <dt>Pages</dt>
            <dd>{snapshot.pageCount}</dd>
          </div>
          <div>
            <dt>Input size</dt>
            <dd>{formatBytes(snapshot.inputBytes)}</dd>
          </div>
          <div>
            <dt>Output size</dt>
            <dd>{formatBytes(snapshot.outputBytes)}</dd>
          </div>
        </dl>
        {beforeAfter}
        <div className="remove-metadata-actions">
          {snapshot.result ? (
            <a
              className="remove-metadata-download"
              href={snapshot.result.url}
              download={snapshot.result.fileName}
            >
              Download cleaned PDF
            </a>
          ) : null}
        </div>
      </div>
    ) : null;

  const errorNode = (
    <>
      <p className="eyebrow">Choose another PDF</p>
      <h2 tabIndex={-1} data-state-heading>
        This PDF could not be cleaned
      </h2>
      <p>
        {snapshot.error
          ? removeMetadataErrorCopy[snapshot.error]
          : "An error occurred."}
      </p>
      {chooser("Choose another PDF")}
    </>
  );

  return (
    <div className="remove-metadata-workflow">
      <p
        id={announcementId}
        className="visually-hidden"
        role="status"
        aria-live="polite"
      >
        {snapshot.announcement}
      </p>
      <ToolShell
        tool={tool}
        state={toToolShellState(snapshot)}
        workspace={workspace}
        status={status}
        result={resultNode}
        error={errorNode}
        related={related}
      />
    </div>
  );
}

function buildRemovedSummary(snapshot: RemoveMetadataSnapshot): string {
  if (!snapshot.removed) return "";
  const parts: string[] = [];
  if (snapshot.removed.standardInfo.length > 0)
    parts.push(
      pluralise(
        snapshot.removed.standardInfo.length,
        "standard metadata field",
      ),
    );
  if (snapshot.removed.customInfo.length > 0)
    parts.push(
      pluralise(snapshot.removed.customInfo.length, "custom metadata field"),
    );
  if (snapshot.removed.xmpStream) parts.push("the XMP metadata stream");
  if (snapshot.removed.trailerId) parts.push("the trailer identifier");
  if (parts.length === 0)
    return "No supported metadata was present. The cleaned PDF is available for download.";
  return `Removed ${formatList(parts)}.`;
}

function buildBeforeAfter(snapshot: RemoveMetadataSnapshot): ReactNode {
  if (!snapshot.before || !snapshot.after) return null;
  return (
    <table className="remove-metadata-before-after">
      <caption className="sr-only">
        Metadata presence before and after cleaning
      </caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Before</th>
          <th scope="col">After</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Standard Info entries</th>
          <td>{snapshot.before.standardInfoCount}</td>
          <td>{snapshot.after.standardInfoCount}</td>
        </tr>
        <tr>
          <th scope="row">Custom Info entries</th>
          <td>{snapshot.before.customInfoCount}</td>
          <td>{snapshot.after.customInfoCount}</td>
        </tr>
        <tr>
          <th scope="row">XMP metadata stream</th>
          <td>{snapshot.before.xmpStreamPresent ? "present" : "absent"}</td>
          <td>{snapshot.after.xmpStreamPresent ? "present" : "absent"}</td>
        </tr>
        <tr>
          <th scope="row">Trailer identifier</th>
          <td>{snapshot.before.trailerIdPresent ? "present" : "absent"}</td>
          <td>{snapshot.after.trailerIdPresent ? "present" : "absent"}</td>
        </tr>
      </tbody>
    </table>
  );
}
