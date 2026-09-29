"use client";

import { useCallback, type ReactNode } from "react";
import type {
  PageGeometry,
  PageReference,
} from "@document-platform/pdf-browser/page-model";
import { PageThumbnail } from "@document-platform/ui";
import type {
  PageSnapshot,
  PreviewSession,
} from "../pdf-preview/preview-session";

export function PageSelectionGrid({
  snapshot,
  session,
  busy,
  selectionLabel,
  selectedText,
  unselectedText,
  register,
  details,
}: {
  snapshot: PageSnapshot;
  session: PreviewSession;
  busy: boolean;
  selectionLabel: (sourcePageNumber: number) => string;
  selectedText: string;
  unselectedText: string;
  register: (id: string, canvas: HTMLCanvasElement | null) => void;
  details?: (
    page: PageReference,
    geometry: PageGeometry | undefined,
  ) => ReactNode;
}) {
  const pages = snapshot.plan?.pages ?? [];
  const selected = new Set(snapshot.selected);
  return (
    <>
      <div className="page-selection-toolbar">
        <p className="selection-summary">
          {selected.size} of {pages.length} pages selected
        </p>
        <button
          type="button"
          className="quiet-button"
          disabled={busy || selected.size === pages.length}
          onClick={() => session.selectAll()}
        >
          Select all pages
        </button>
        <button
          type="button"
          className="quiet-button"
          disabled={busy || selected.size === 0}
          onClick={() => session.clearSelection()}
        >
          Clear selection
        </button>
      </div>
      <ol className="organize-grid page-selection-grid" aria-label="PDF pages">
        {pages.map((page, index) => (
          <SelectionPage
            key={page.id}
            page={page}
            index={index}
            count={pages.length}
            selected={selected.has(page.id)}
            busy={busy}
            snapshot={snapshot}
            session={session}
            selectionLabel={selectionLabel(page.sourcePageNumber)}
            selectedText={selectedText}
            unselectedText={unselectedText}
            register={register}
            details={details?.(page, snapshot.geometry[page.id])}
          />
        ))}
      </ol>
    </>
  );
}

function SelectionPage({
  page,
  index,
  count,
  selected,
  busy,
  snapshot,
  session,
  selectionLabel,
  selectedText,
  unselectedText,
  register,
  details,
}: {
  page: PageReference;
  index: number;
  count: number;
  selected: boolean;
  busy: boolean;
  snapshot: PageSnapshot;
  session: PreviewSession;
  selectionLabel: string;
  selectedText: string;
  unselectedText: string;
  register: (id: string, canvas: HTMLCanvasElement | null) => void;
  details?: ReactNode;
}) {
  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => register(page.id, canvas),
    [page.id, register],
  );
  return (
    <li
      data-page-id={page.id}
      data-source-page={page.sourcePageNumber}
      data-selected={selected}
      aria-posinset={index + 1}
      aria-setsize={count}
    >
      <PageThumbnail
        pageNumber={page.sourcePageNumber}
        selected={selected}
        disabled={busy}
        status={snapshot.thumbnails[page.id] ?? "idle"}
        rotation={page.rotationDelta}
        canvasRef={canvasRef}
        onSelect={(checked) => session.select(page.id, checked)}
        selectionLabel={selectionLabel}
      >
        <p
          className="page-selection-state"
          data-active={selected}
          aria-live="off"
        >
          {selected ? selectedText : unselectedText}
        </p>
        {details}
      </PageThumbnail>
    </li>
  );
}
