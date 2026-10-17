"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { PdfToTextLimits } from "@document-platform/pdf-browser/pdf-to-text";
import type { ToolDefinition } from "@document-platform/tool-registry";
import { FilePicker, ToolShell } from "@document-platform/ui";
import {
  PdfTextSession,
  extractedTextFilename,
  formatByteCount,
  formatCharacterCount,
  pdfTextErrorCopy,
  type PdfTextSnapshot,
} from "./session";

function formatPageList(numbers: readonly number[]) {
  // Group consecutive runs: [1,2,3,5,7,8] -> "1-3, 5, 7-8".
  if (numbers.length === 0) return "";
  const sorted = [...numbers].sort((a, b) => a - b);
  const groups: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index <= sorted.length; index++) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    groups.push(start === previous ? `${start}` : `${start}–${previous}`);
    start = current;
    previous = current;
  }
  return groups.join(", ");
}

export function PdfToTextWorkspace({
  tool,
  limits,
  related,
}: {
  tool: ToolDefinition;
  limits: PdfToTextLimits;
  related: ReactNode;
}) {
  const [session] = useState(() => new PdfTextSession(limits));
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const announcementId = useId();
  const previewId = useId();
  const partialId = useId();
  const noTextId = useId();
  const errorId = useId();
  const previewRef = useRef<HTMLPreElement | null>(null);
  const stateHeadingRef = useRef<HTMLDivElement>(null);
  const copyAcknowledgement = useRef<number | undefined>(undefined);
  const previousStateRef = useRef(snapshot.state);

  useEffect(() => {
    const reset = () => session.reset();
    window.addEventListener("pagehide", reset);
    return () => {
      window.removeEventListener("pagehide", reset);
      session.dispose();
    };
  }, [session]);

  useEffect(() => {
    if (previousStateRef.current !== snapshot.state) {
      stateHeadingRef.current
        ?.querySelector<HTMLElement>("[data-state-heading]")
        ?.focus();
      previousStateRef.current = snapshot.state;
    }
  }, [snapshot.state]);

  useEffect(() => {
    if (snapshot.copyState === "copied") {
      if (copyAcknowledgement.current)
        window.clearTimeout(copyAcknowledgement.current);
      copyAcknowledgement.current = window.setTimeout(() => {
        session.acknowledgeCopy();
      }, 2000);
    }
    return () => {
      if (copyAcknowledgement.current)
        window.clearTimeout(copyAcknowledgement.current);
    };
  }, [snapshot.copyState, session]);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files[0]) void session.setSource(files[0]);
    },
    [session],
  );

  const handleDownload = useCallback(() => {
    const result = session.getSnapshot().result;
    if (!result) return;
    const anchor = document.createElement("a");
    anchor.href = result.url;
    anchor.download = extractedTextFilename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, [session]);

  const partialPages = useMemo(
    () => snapshot.pagesWithoutText ?? [],
    [snapshot.pagesWithoutText],
  );
  const partialSummary = useMemo(
    () => formatPageList(partialPages),
    [partialPages],
  );

  const idleWorkspace = (
    <div className="pdf-text-workspace" ref={stateHeadingRef}>
      <h2 tabIndex={-1} data-state-heading>
        Extract text from a PDF
      </h2>
      <p className="small-copy">
        The PDF is read in your browser. The extracted text, download file and
        preview never leave this device.
      </p>
      <FilePicker
        accept={tool.acceptedTypes.flatMap((type) => type.extensions).join(",")}
        label="Choose PDF"
        help="Select one PDF or drop it here. Scanned, image-based PDFs need OCR and are reported as such."
        multiple={false}
        onFiles={handleFiles}
      />
    </div>
  );

  const processing = (
    <div className="pdf-text-workspace" ref={stateHeadingRef}>
      <p className="eyebrow">01 Open · 02 Extract · 03 Preview</p>
      <h2 tabIndex={-1} data-state-heading>
        {snapshot.state === "loading"
          ? "Opening the PDF"
          : "Extracting text locally"}
      </h2>
      <p className="small-copy">
        {snapshot.state === "loading"
          ? "Validating and opening the document in your browser."
          : snapshot.progress
            ? `Extracting page ${snapshot.progress.current} of ${snapshot.progress.total}.`
            : "Extracting text from each page."}
      </p>
      <button
        type="button"
        className="quiet-button"
        onClick={() => session.cancel()}
      >
        Cancel
      </button>
    </div>
  );

  const noTextPanel = (
    <div className="pdf-text-workspace" ref={stateHeadingRef}>
      <p className="eyebrow">Result</p>
      <h2 tabIndex={-1} data-state-heading>
        No text layer was found
      </h2>
      <p id={noTextId} className="pdf-text-no-text">
        No meaningful text layer was found. This PDF may be scanned or
        image-based and may require OCR. This product does not perform OCR, and
        no document bytes are sent to any server.
      </p>
      <button
        type="button"
        className="primary-button"
        onClick={() => session.reset()}
      >
        Choose another PDF
      </button>
    </div>
  );

  const errorPanel = (
    <div className="pdf-text-workspace" ref={stateHeadingRef}>
      <p className="eyebrow">Result</p>
      <h2 tabIndex={-1} data-state-heading>
        Text could not be extracted
      </h2>
      <p id={errorId} role="alert">
        {snapshot.error ? pdfTextErrorCopy[snapshot.error] : ""}
      </p>
      <button
        type="button"
        className="primary-button"
        onClick={() => session.reset()}
      >
        Choose another PDF
      </button>
    </div>
  );

  const readyPanel = (
    <div className="pdf-text-workspace" ref={stateHeadingRef}>
      <p className="eyebrow">
        01 Open · 02 Extract · 03 Preview · 04 Copy or Download
      </p>
      <h2 tabIndex={-1} data-state-heading>
        Extracted text ready
      </h2>
      <p className="small-copy">
        {snapshot.result
          ? `${formatCharacterCount(snapshot.result.characters)} across ${snapshot.pagesWithText ?? 0} of ${snapshot.totalPages ?? 0} ${snapshot.totalPages === 1 ? "page" : "pages"} · ${formatByteCount(snapshot.result.bytes)} UTF-8 download.`
          : ""}
      </p>
      {partialPages.length > 0 && (
        <p id={partialId} className="pdf-text-partial" role="note">
          Some pages contained no meaningful text and were kept blank in the
          output: {partialSummary}. Those pages may be scanned, image-only or
          otherwise missing an embedded text layer.
        </p>
      )}
      {snapshot.previewTruncated && (
        <p className="pdf-text-truncation" role="note">
          Preview shortened for performance. Copy and Download use the complete
          extracted text; this preview shows the first{" "}
          {formatCharacterCount(snapshot.previewText?.length ?? 0)}.
        </p>
      )}
      <div
        className="pdf-text-preview-shell"
        role="region"
        aria-labelledby={previewId}
      >
        <h3 id={previewId} className="pdf-text-preview-label">
          Preview
        </h3>
        {/* Extracted PDF text is untrusted document content. It is rendered via
            React text nodes inside <pre>, never through dangerouslySetInnerHTML
            or any HTML/Markdown interpretation path. The <pre> only preserves
            whitespace; it does not re-interpret the string. */}
        <pre
          ref={previewRef}
          className="pdf-text-preview"
          tabIndex={0}
          aria-label="Extracted text preview"
        >
          {snapshot.previewText ?? ""}
        </pre>
      </div>
      <div className="pdf-text-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => void session.copy()}
          disabled={snapshot.copyState === "copying"}
        >
          Copy text
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleDownload}
        >
          Download TXT
        </button>
        <button
          type="button"
          className="quiet-button"
          onClick={() => session.reset()}
        >
          Start over
        </button>
      </div>
      <div
        className="pdf-text-announcer"
        role="status"
        aria-live="polite"
        id={announcementId}
      >
        {snapshot.copyState === "copied"
          ? "Extracted text copied."
          : snapshot.copyState === "failed"
            ? pdfTextErrorCopy.CLIPBOARD_FAILED
            : ""}
      </div>
    </div>
  );

  const shellState: PdfTextSnapshot["state"] | "idle" = snapshot.state;
  const workspaceNode: ReactNode = idleWorkspace;
  let statusNode: ReactNode = undefined;
  let resultNode: ReactNode = undefined;
  let errorNode: ReactNode = undefined;
  if (shellState === "loading" || shellState === "extracting") {
    statusNode = processing;
  } else if (shellState === "ready") {
    resultNode = readyPanel;
  } else if (shellState === "no-text") {
    resultNode = noTextPanel;
  } else if (shellState === "error") {
    errorNode = errorPanel;
  }
  // Map session state to ToolShell state vocabulary.
  const toolShellState =
    shellState === "loading" || shellState === "extracting"
      ? "processing"
      : shellState === "ready" || shellState === "no-text"
        ? "result"
        : shellState === "error"
          ? "error"
          : "idle";
  return (
    <ToolShell
      tool={tool}
      state={toolShellState}
      workspace={workspaceNode}
      status={statusNode}
      result={resultNode}
      error={errorNode}
      related={related}
    />
  );
}
