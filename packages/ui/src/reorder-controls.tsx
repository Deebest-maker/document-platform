"use client";
import { useRef } from "react";

export function ReorderControls({
  pageNumber,
  canMoveEarlier,
  canMoveLater,
  onMove,
}: {
  pageNumber: number;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const earlier = useRef<HTMLButtonElement>(null),
    later = useRef<HTMLButtonElement>(null);
  const move = (direction: -1 | 1) => {
    onMove(direction);
    requestAnimationFrame(() => {
      const preferred = direction === -1 ? earlier.current : later.current;
      const fallback = direction === -1 ? later.current : earlier.current;
      if (preferred && !preferred.disabled)
        preferred.focus({ preventScroll: true });
      else if (fallback && !fallback.disabled)
        fallback.focus({ preventScroll: true });
    });
  };
  return (
    <div
      className="page-reorder"
      role="group"
      aria-label={`Reorder page ${pageNumber}`}
    >
      <button
        ref={earlier}
        type="button"
        disabled={!canMoveEarlier}
        onClick={() => move(-1)}
        aria-label={`Move page ${pageNumber} earlier`}
      >
        Move earlier
      </button>
      <button
        ref={later}
        type="button"
        disabled={!canMoveLater}
        onClick={() => move(1)}
        aria-label={`Move page ${pageNumber} later`}
      >
        Move later
      </button>
    </div>
  );
}
