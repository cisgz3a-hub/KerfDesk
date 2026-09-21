import { useEffect, useRef, useState } from 'react';
import type { SecondPassDrawing } from './second-pass-preview';

export type CanvasView = { x: number; y: number; scale: number };
export type CanvasSize = { width: number; height: number };
export function fitDrawing(drawing: SecondPassDrawing, size: CanvasSize): CanvasView {
  const b = drawing.bounds;
  const scale = Math.max(
    0.01,
    Math.min(
      (size.width - 48) / Math.max(1, b.maxX - b.minX),
      (size.height - 48) / Math.max(1, b.maxY - b.minY),
    ),
  );
  return {
    x: size.width / 2 - ((b.minX + b.maxX) * scale) / 2,
    y: size.height / 2 - ((b.minY + b.maxY) * scale) / 2,
    scale,
  };
}
function zoomed(
  old: CanvasView,
  factor: number,
  anchor: { x: number; y: number },
  fitScale: number,
): CanvasView {
  const scale = Math.min(fitScale * 128, Math.max(fitScale / 4, old.scale * factor));
  return {
    scale,
    x: anchor.x - ((anchor.x - old.x) * scale) / old.scale,
    y: anchor.y - ((anchor.y - old.y) * scale) / old.scale,
  };
}
export function useSecondPassViewport(drawing: SecondPassDrawing) {
  const host = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const [size, setSize] = useState<CanvasSize>({ width: 800, height: 500 });
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, scale: 1 });
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setView(fitDrawing(drawing, size));
  }, [drawing, size]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (active.current) return;
      const rect = element.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left - element.clientLeft,
        y: event.clientY - rect.top - element.clientTop,
      };
      setView((old) =>
        zoomed(old, Math.exp(-event.deltaY * 0.002), anchor, fitDrawing(drawing, size).scale),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [drawing, size]);
  const fit = fitDrawing(drawing, size);
  return {
    host,
    active,
    size,
    view,
    setView,
    fit: () => setView(fit),
    percent: Math.round((view.scale / fit.scale) * 100),
    zoom: (factor: number) => {
      if (!active.current)
        setView((old) => zoomed(old, factor, { x: size.width / 2, y: size.height / 2 }, fit.scale));
    },
  };
}
export type SecondPassViewport = ReturnType<typeof useSecondPassViewport>;
