"use client";
import { useCallback, useEffect } from "react";
import { PageThumbnail, ReorderControls } from "@document-platform/ui";
import type { PageReference } from "@document-platform/pdf-browser/page-model";
import { usePagePreview } from "../../../components/pdf-preview/use-page-preview";
import type {
  PageSnapshot,
  PreviewSession,
} from "../../../components/pdf-preview/preview-session";

function PageItem({
  page,
  index,
  count,
  snapshot,
  session,
  register,
}: {
  page: PageReference;
  index: number;
  count: number;
  snapshot: PageSnapshot;
  session: PreviewSession;
  register: (id: string, canvas: HTMLCanvasElement | null) => void;
}) {
  const ref = useCallback(
    (canvas: HTMLCanvasElement | null) => register(page.id, canvas),
    [page.id, register],
  );
  const busy = snapshot.state === "exporting";
  return (
    <li data-page-id={page.id} data-source-page={page.sourcePageNumber}>
      <PageThumbnail
        pageNumber={page.sourcePageNumber}
        selected={snapshot.selected.includes(page.id)}
        disabled={busy}
        status={snapshot.thumbnails[page.id] ?? "idle"}
        rotation={page.rotationDelta}
        canvasRef={ref}
        onSelect={(checked) => session.select(page.id, checked)}
      >
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

export function Consumer() {
  const { snapshot, session, registerCanvas } = usePagePreview();
  // Only this separately built, explicitly configured test application exposes
  // safe numeric instrumentation. It is absent from the product route tree.
  useEffect(() => {
    const target = window as unknown as {
      foundationStats?: () => ReturnType<PreviewSession["stats"]>;
    };
    target.foundationStats = () => session.stats();
    return () => {
      delete target.foundationStats;
    };
  }, [session]);
  return (
    <main className="foundation-test">
      <h1>PDF foundation test consumer</h1>
      <p>Explicit test configuration. LOCAL processing. No document upload.</p>
      <label>
        Choose test PDF{" "}
        <input
          type="file"
          accept=".pdf,application/pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void session.setSource(file);
          }}
        />
      </label>
      <p role="status" aria-live="polite">
        {snapshot.announcement}
      </p>
      {snapshot.error && (
        <p role="alert">
          {snapshot.error}: No unvalidated download was created.
        </p>
      )}
      <fieldset
        className="foundation-actions"
        disabled={!snapshot.plan || snapshot.state === "exporting"}
      >
        <legend>Foundation test actions</legend>
        <button type="button" onClick={() => session.rotate()}>
          Rotate selected
        </button>
        <button type="button" onClick={() => session.rotate(true)}>
          Rotate all
        </button>
        <button type="button" onClick={() => session.extract()}>
          Retain selected
        </button>
        <button type="button" onClick={() => session.delete()}>
          Delete selected
        </button>
        <button type="button" onClick={() => void session.export()}>
          Export test PDF
        </button>
      </fieldset>
      <div className="foundation-actions">
        <button
          type="button"
          disabled={snapshot.state !== "exporting"}
          onClick={session.cancelExport}
        >
          Cancel export
        </button>
        <button type="button" onClick={() => void session.reset()}>
          Reset test session
        </button>
        {snapshot.result && (
          <a className="button" href={snapshot.result.url} download="pages.pdf">
            Download test PDF
          </a>
        )}
      </div>
      <ol className="foundation-pages">
        {snapshot.plan?.pages.map((page, index) => (
          <PageItem
            key={page.id}
            page={page}
            index={index}
            count={snapshot.plan!.pages.length}
            snapshot={snapshot}
            session={session}
            register={registerCanvas}
          />
        ))}
      </ol>
    </main>
  );
}
