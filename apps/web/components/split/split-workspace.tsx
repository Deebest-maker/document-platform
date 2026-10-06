"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  PagePlan,
  PageReference,
} from "@document-platform/pdf-browser/page-model";
import {
  planSelectedPageSplits,
  planSplitRangeGroups,
  SplitRangeError,
} from "@document-platform/pdf-browser/split-plan";
import type { SplitLimits } from "@document-platform/pdf-browser/split";
import type { ToolDefinition } from "@document-platform/tool-registry";
import { FilePicker, PageThumbnail, ToolShell } from "@document-platform/ui";
import { formatBytes } from "../merge/session";
import { usePagePreview } from "../pdf-preview/use-page-preview";
import { pageToolErrors, pageToolState } from "../page-tools/copy";
import { PageSelectionGrid } from "../page-tools/page-selection-grid";

type Mode = "ranges" | "selected";
type Group = { id: number; value: string };

const phaseCopy = {
  reading: "Reading the source PDF locally…",
  transforming: "Creating each requested PDF locally…",
  validating: "Reopening and validating each generated PDF…",
  archiving: "Packaging the validated PDFs into one local ZIP…",
} as const;

function rangeError(error: SplitRangeError, pageCount: number) {
  switch (error.code) {
    case "EMPTY_GROUP":
      return "Enter at least one page or range.";
    case "MALFORMED_RANGE":
      return "Use page numbers, ranges, and commas, such as 1-3,5.";
    case "NON_POSITIVE_PAGE":
      return "Page numbers start at 1.";
    case "REVERSED_RANGE":
      return `“${error.details.token}” is reversed. Put the lower page first.`;
    case "PAGE_OUT_OF_RANGE":
      return `Page ${error.details.page ?? "requested"} does not exist. This document has ${pageCount} pages.`;
    case "DUPLICATE_PAGE":
      return `Page ${error.details.page} appears more than once in this output. Remove the duplicate or overlapping range.`;
    case "OUTPUT_LIMIT":
      return "This split requests more output files than the current limit.";
  }
  return "This output group is not valid.";
}

export function SplitWorkspace({
  tool,
  related,
}: {
  tool: ToolDefinition;
  related: ReactNode;
}) {
  const limits = tool.limits!;
  const splitLimits: SplitLimits = {
    maxOutputs: limits.maxOutputs!,
    maxCombinedPdfBytes: limits.maxCombinedOutputBytes!,
    maxArchiveBytes: limits.maxArchiveBytes!,
  };
  const { snapshot, session, registerCanvas } = usePagePreview({
    maxInputBytes: limits.maxFileBytes,
    maxPages: limits.maxPages,
    maxOutputBytes: limits.maxOutputBytes,
  });
  const root = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const groupInputs = useRef(new Map<number, HTMLInputElement>());
  const nextGroupId = useRef(2);
  const [mode, setMode] = useState<Mode>("ranges");
  const [groups, setGroups] = useState<Group[]>([{ id: 1, value: "" }]);
  const [issues, setIssues] = useState<Record<number, string>>({});
  const previousState = useRef(snapshot.state);
  const previousSession = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (previousState.current !== snapshot.state) {
      root.current?.querySelector<HTMLElement>("[data-state-heading]")?.focus();
      previousState.current = snapshot.state;
    }
  }, [snapshot.state]);
  useEffect(() => {
    const sessionId = snapshot.plan?.sessionId;
    if (sessionId && sessionId !== previousSession.current) {
      setMode("ranges");
      setGroups([{ id: 1, value: "" }]);
      setIssues({});
      nextGroupId.current = 2;
    }
    previousSession.current = sessionId;
  }, [snapshot.plan?.sessionId]);
  const busy = snapshot.state === "exporting";
  const selectedCount = snapshot.selected.length;
  const canGenerate =
    mode === "selected"
      ? selectedCount > 0 && selectedCount <= splitLimits.maxOutputs
      : groups.length > 0 && groups.length <= splitLimits.maxOutputs;

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

  const addGroup = () => {
    if (groups.length >= splitLimits.maxOutputs) return;
    const id = nextGroupId.current++;
    setGroups((current) => [...current, { id, value: "" }]);
    requestAnimationFrame(() => groupInputs.current.get(id)?.focus());
  };
  const removeGroup = (id: number) => {
    if (groups.length === 1) return;
    const index = groups.findIndex((group) => group.id === id);
    const focusId = groups[index - 1]?.id ?? groups[index + 1]?.id;
    setGroups((current) => current.filter((group) => group.id !== id));
    setIssues((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (focusId !== undefined)
      queueMicrotask(() => groupInputs.current.get(focusId)?.focus());
    else queueMicrotask(() => addButton.current?.focus());
  };

  const createPlans = (): PagePlan[] | undefined => {
    if (!snapshot.plan) return;
    if (mode === "selected") {
      try {
        return planSelectedPageSplits(
          snapshot.plan,
          snapshot.selected,
          splitLimits.maxOutputs,
        );
      } catch {
        return undefined;
      }
    }
    const nextIssues: Record<number, string> = {};
    const plans: PagePlan[] = [];
    for (const group of groups) {
      try {
        plans.push(
          planSplitRangeGroups(
            snapshot.plan,
            [group.value],
            splitLimits.maxOutputs,
          )[0],
        );
      } catch (error) {
        nextIssues[group.id] =
          error instanceof SplitRangeError
            ? rangeError(error, snapshot.plan.sourcePageCount)
            : "This output group is not valid.";
      }
    }
    setIssues(nextIssues);
    if (Object.keys(nextIssues).length) {
      const first = groups.find((group) => nextIssues[group.id]);
      if (first)
        queueMicrotask(() => groupInputs.current.get(first.id)?.focus());
      return undefined;
    }
    return plans;
  };

  const generate = () => {
    const plans = createPlans();
    if (plans) void session.exportSplit(plans, splitLimits);
  };

  const ready = snapshot.plan ? (
    <>
      <p className="eyebrow">01 Choose · 02 Define outputs · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        Define your split outputs
      </h2>
      <fieldset className="split-mode" disabled={busy}>
        <legend>How should the PDF be split?</legend>
        <label>
          <input
            type="radio"
            name="split-mode"
            value="ranges"
            checked={mode === "ranges"}
            onChange={() => setMode("ranges")}
          />
          <span>
            <strong>Range groups</strong>
            <small>Each group becomes one PDF.</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="split-mode"
            value="selected"
            checked={mode === "selected"}
            onChange={() => setMode("selected")}
          />
          <span>
            <strong>Individual selected pages</strong>
            <small>Each selected page becomes its own PDF.</small>
          </span>
        </label>
      </fieldset>

      {snapshot.error && (
        <p className="organize-error" role="alert">
          {pageToolErrors[snapshot.error]}
        </p>
      )}

      {mode === "ranges" ? (
        <>
          <div className="split-groups" aria-label="Output PDF groups">
            {groups.map((group, index) => {
              const inputId = `split-group-${group.id}`;
              const errorId = `${inputId}-error`;
              return (
                <div className="split-group" key={group.id}>
                  <div className="split-group__heading">
                    <label htmlFor={inputId}>
                      Output {index + 1} page ranges
                    </label>
                    <span>split-{String(index + 1).padStart(2, "0")}.pdf</span>
                  </div>
                  <div className="split-group__controls">
                    <input
                      id={inputId}
                      ref={(node) => {
                        if (node) groupInputs.current.set(group.id, node);
                        else groupInputs.current.delete(group.id);
                      }}
                      value={group.value}
                      placeholder="1-3,5"
                      inputMode="numeric"
                      disabled={busy}
                      aria-invalid={Boolean(issues[group.id])}
                      aria-describedby={issues[group.id] ? errorId : undefined}
                      onChange={(event) => {
                        const value = event.target.value;
                        setGroups((current) =>
                          current.map((item) =>
                            item.id === group.id ? { ...item, value } : item,
                          ),
                        );
                        setIssues((current) => {
                          if (!current[group.id]) return current;
                          const next = { ...current };
                          delete next[group.id];
                          return next;
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={busy || groups.length === 1}
                      aria-label={`Remove output ${index + 1}`}
                      onClick={() => removeGroup(group.id)}
                    >
                      Remove
                    </button>
                  </div>
                  {issues[group.id] && (
                    <p id={errorId} className="split-group__error">
                      {issues[group.id]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <button
            ref={addButton}
            type="button"
            className="quiet-button"
            disabled={busy || groups.length >= splitLimits.maxOutputs}
            onClick={addGroup}
          >
            Add output group
          </button>
          <p className="small-copy">
            A page may appear in different outputs. Within one output, duplicate
            pages and overlapping ranges are rejected.
          </p>
          <RangePreview
            plan={snapshot.plan}
            snapshot={snapshot}
            register={registerCanvas}
          />
        </>
      ) : (
        <>
          <p className="page-selection-guidance">
            {selectedCount
              ? `${selectedCount} ${selectedCount === 1 ? "page" : "pages"} will become ${selectedCount} separate PDF ${selectedCount === 1 ? "file" : "files"} in source order.`
              : "Select at least one page. To combine selected pages into one PDF, use Extract PDF Pages."}
          </p>
          {selectedCount > splitLimits.maxOutputs && (
            <p className="split-group__error" role="alert">
              Select no more than {splitLimits.maxOutputs} pages for one batch.
            </p>
          )}
          <PageSelectionGrid
            snapshot={snapshot}
            session={session}
            busy={busy}
            selectionLabel={(page) =>
              `Select source page ${page} as a separate PDF`
            }
            selectedText="Will become a separate PDF"
            unselectedText="Not selected"
            register={registerCanvas}
          />
        </>
      )}

      <div className="organize-toolbar split-actions">
        <button
          className="primary-button"
          type="button"
          disabled={busy || !canGenerate}
          onClick={generate}
        >
          Generate split files
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
      <p className="small-copy organize-limits">
        Current engineering limits: one PDF · {formatBytes(limits.maxFileBytes)}{" "}
        input · {limits.maxPages} pages · {splitLimits.maxOutputs} outputs ·{" "}
        {formatBytes(splitLimits.maxCombinedPdfBytes)} combined generated PDFs ·{" "}
        {formatBytes(splitLimits.maxArchiveBytes)} final ZIP. Password-protected
        PDFs are not supported.
      </p>
    </>
  ) : (
    <>
      <p className="eyebrow">01 Choose · 02 Define outputs · 03 Download</p>
      <h2 tabIndex={-1} data-state-heading>
        Choose a PDF to split
      </h2>
      {choose()}
      <p className="small-copy organize-limits">
        Current limits: one PDF · {formatBytes(limits.maxFileBytes)} input ·{" "}
        {limits.maxPages} pages. Password-protected PDFs are not supported.
      </p>
    </>
  );

  const result = snapshot.result;
  return (
    <div ref={root} className="organize-workflow split-workflow">
      <p className="visually-hidden" role="status" aria-live="polite">
        {snapshot.announcement}
      </p>
      <ToolShell
        tool={tool}
        state={pageToolState(snapshot)}
        workspace={ready}
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
                : "Creating your split files"}
            </h2>
            <p>
              {snapshot.state === "loading"
                ? "Validating the PDF and preparing page previews locally…"
                : snapshot.phase
                  ? phaseCopy[snapshot.phase]
                  : "Pausing previews and starting local generation…"}
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
          result && (
            <>
              <p className="eyebrow">Ready to save</p>
              <h2 tabIndex={-1} data-state-heading>
                {result.kind === "zip"
                  ? "Your split ZIP is ready"
                  : "Your split PDF is ready"}
              </h2>
              <p>
                {result.fileCount} validated{" "}
                {result.fileCount === 1 ? "PDF" : "PDFs"} containing{" "}
                {result.pageCount} total page references.
              </p>
              <div className="organize-toolbar">
                <a
                  className="primary-button"
                  href={result.url}
                  download={
                    result.kind === "zip"
                      ? "split-pdf-files.zip"
                      : "split-01.pdf"
                  }
                >
                  {result.kind === "zip"
                    ? "Download split ZIP"
                    : "Download split PDF"}
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

function RangePreview({
  plan,
  snapshot,
  register,
}: {
  plan: PagePlan;
  snapshot: ReturnType<typeof usePagePreview>["snapshot"];
  register: (id: string, canvas: HTMLCanvasElement | null) => void;
}) {
  return (
    <ol className="organize-grid split-preview-grid" aria-label="PDF pages">
      {plan.pages.map((page) => (
        <RangePage
          key={page.id}
          page={page}
          status={snapshot.thumbnails[page.id] ?? "idle"}
          register={register}
        />
      ))}
    </ol>
  );
}

function RangePage({
  page,
  status,
  register,
}: {
  page: PageReference;
  status: "idle" | "loading" | "ready" | "error";
  register: (id: string, canvas: HTMLCanvasElement | null) => void;
}) {
  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => register(page.id, canvas),
    [page.id, register],
  );
  return (
    <li data-page-id={page.id} data-source-page={page.sourcePageNumber}>
      <PageThumbnail
        pageNumber={page.sourcePageNumber}
        status={status}
        rotation={page.rotationDelta}
        canvasRef={canvasRef}
      >
        <p className="page-selection-state">
          Source page {page.sourcePageNumber}
        </p>
      </PageThumbnail>
    </li>
  );
}
