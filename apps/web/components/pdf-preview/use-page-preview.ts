"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  pageLimits,
  type PageLimits,
} from "@document-platform/pdf-browser/pages";
import { PreviewSession } from "./preview-session";

export function usePagePreview(limits: PageLimits = pageLimits) {
  const [session] = useState(() => new PreviewSession({}, limits));
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const nearby = useRef(new Set<string>());
  const observer = useRef<IntersectionObserver | null>(null);
  const frame = useRef(0);
  const refresh = useCallback(() => {
    const plan = session.getSnapshot().plan;
    if (!plan) return;
    const requests = plan.pages
      .flatMap((page) => {
        const canvas = canvases.current.get(page.id);
        if (!canvas || !nearby.current.has(page.id)) return [];
        const rect = canvas.parentElement!.getBoundingClientRect();
        const visible = rect.bottom > 0 && rect.top < window.innerHeight;
        return [
          {
            ...page,
            canvas,
            size: { width: 240, height: 320, dpr: window.devicePixelRatio },
            revision: `${page.rotationDelta}:${window.devicePixelRatio}`,
            visible,
            distance: Math.abs(
              (rect.top + rect.bottom) / 2 - window.innerHeight / 2,
            ),
          },
        ];
      })
      .sort(
        (a, b) =>
          Number(b.visible) - Number(a.visible) || a.distance - b.distance,
      );
    session.updateVisible(requests);
  }, [session]);
  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(refresh);
  }, [refresh]);
  const registerCanvas = useCallback(
    (id: string, canvas: HTMLCanvasElement | null) => {
      const old = canvases.current.get(id);
      if (old?.parentElement) observer.current?.unobserve(old.parentElement);
      canvases.current.delete(id);
      nearby.current.delete(id);
      if (canvas?.parentElement) {
        canvases.current.set(id, canvas);
        canvas.parentElement.dataset.pageId = id;
        observer.current?.observe(canvas.parentElement);
      }
      schedule();
    },
    [schedule],
  );
  useEffect(() => {
    const canvasRegistry = canvases.current,
      nearbyPages = nearby.current;
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.pageId!;
          if (entry.isIntersecting) nearby.current.add(id);
          else nearby.current.delete(id);
        }
        schedule();
      },
      { rootMargin: "400px 0px" },
    );
    for (const canvas of canvases.current.values())
      observer.current.observe(canvas.parentElement!);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const reset = () => {
      void session.reset();
    };
    window.addEventListener("pagehide", reset);
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      cancelAnimationFrame(frame.current);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pagehide", reset);
      canvasRegistry.clear();
      nearbyPages.clear();
      void session.destroy();
    };
  }, [session, schedule]);
  useEffect(() => {
    schedule();
  }, [snapshot.plan, schedule]);
  return { snapshot, session, registerCanvas };
}
