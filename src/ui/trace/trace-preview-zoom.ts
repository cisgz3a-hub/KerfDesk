import { useLayoutEffect, useRef, useState } from 'react';

export const MIN_PREVIEW_ZOOM = 1;
export const MAX_PREVIEW_ZOOM = 16;

// Zoom is relative to the fitted image, not its native pixel size. Both stage
// dimensions scale together, so contain/meet and boundary coordinates agree.
export function useTracePreviewZoom(): {
  readonly zoom: number;
  readonly viewportRef: React.RefObject<HTMLDivElement>;
  readonly zoomTo: (value: number) => void;
} {
  const [zoom, setZoom] = useState(MIN_PREVIEW_ZOOM);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<{ readonly left: number; readonly top: number } | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const target = pendingScroll.current;
    if (viewport === null || target === null) return;
    viewport.scrollLeft = target.left;
    viewport.scrollTop = target.top;
    pendingScroll.current = null;
  }, [zoom]);

  function zoomTo(value: number): void {
    const next = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, value));
    if (!Number.isFinite(next) || next === zoom) return;
    const viewport = viewportRef.current;
    if (viewport !== null) {
      // Capture before shrinking the stage: the browser may clamp its current
      // scroll offset during layout, losing the previous inspection centre.
      pendingScroll.current = {
        left: zoomOffset(viewport.scrollLeft, viewport.clientWidth, zoom, next),
        top: zoomOffset(viewport.scrollTop, viewport.clientHeight, zoom, next),
      };
    }
    setZoom(next);
  }

  return { zoom, viewportRef, zoomTo };
}

function zoomOffset(offset: number, size: number, previous: number, next: number): number {
  return next === MIN_PREVIEW_ZOOM ? 0 : (offset + size / 2) * (next / previous) - size / 2;
}
