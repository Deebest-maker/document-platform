"use client";
import type { RefCallback, ReactNode } from "react";

export interface PageThumbnailProps {
  pageNumber: number;
  selected?: boolean;
  disabled?: boolean;
  status: "idle" | "loading" | "ready" | "error";
  rotation: number;
  canvasRef: RefCallback<HTMLCanvasElement>;
  onSelect?: (selected: boolean) => void;
  children?: ReactNode;
}
export function PageThumbnail({
  pageNumber,
  selected = false,
  disabled,
  status,
  rotation,
  canvasRef,
  onSelect,
  children,
}: PageThumbnailProps) {
  return (
    <figure
      className="page-thumbnail"
      data-selected={selected}
      aria-label={`Source page ${pageNumber}`}
    >
      <div className="page-thumbnail__surface" aria-busy={status === "loading"}>
        <canvas
          width={0}
          height={0}
          ref={canvasRef}
          role="img"
          aria-label={`Preview of source page ${pageNumber}, additional rotation ${rotation} degrees`}
        />
        {status !== "ready" && (
          <span>
            {status === "error"
              ? "Preview unavailable"
              : status === "loading"
                ? "Rendering preview…"
                : "Preview waits until nearby"}
          </span>
        )}
      </div>
      <figcaption>
        {onSelect && (
          <label>
            <input
              type="checkbox"
              checked={selected}
              disabled={disabled}
              onChange={(event) => onSelect(event.target.checked)}
            />{" "}
            Select page {pageNumber}
          </label>
        )}
        {rotation !== 0 && (
          <span className="page-thumbnail__rotation">
            Additional rotation: {rotation}°
          </span>
        )}
      </figcaption>
      {children}
    </figure>
  );
}
