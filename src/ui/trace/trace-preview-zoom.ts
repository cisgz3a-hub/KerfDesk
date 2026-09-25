import { useLayoutEffect, useRef, useState } from 'react';

import {
  anchoredScrollOffset,
  clampPreviewZoom,
  MIN_PREVIEW_ZOOM,
  previewZoomRange,
  type PreviewZoomRange,
} from './trace-preview-zoom-math';

type Size = { readonly width: number; readonly height: number };
type ScrollPosition = { readonly left: number; readonly top: number };
/** A point in client (window) coordinates. */
export type ClientPoint = { readonly clientX: number; readonly clientY: number };

export type TracePreviewZoom = {
  readonly zoom: number;
  readonly range: PreviewZoomRange;
  readonly viewportRef: React.RefObject<HTMLDivElement>;
  /** Zoom about `anchor`, or about the viewport centre when omitted. */
  readonly zoomTo: (value: number, anchor?: ClientPoint) => void;
  readonly zoomBy: (factor: number, anchor?: ClientPoint) => void;
  /** Scroll the view by screen pixels (positive reveals content to the right/below). */
  readonly panBy: (dx: number, dy: number) => void;
};

// Zoom is relative to the fitted image, not its native pixel size. Both stage
// dimensions scale together, so contain/meet and boundary coordinates agree.
// Zoom and pan are local viewing state only: nothing here reaches the trace.
export function useTracePreviewZoom(image?: Size): TracePreviewZoom {
  const [zoom, setZoom] = useState(MIN_PREVIEW_ZOOM);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportSize = useViewportSize(viewportRef);
  const range = previewZoomRange(image, viewportSize);
  // Rapid wheel/pinch events can arrive before React re-renders. Chain each
  // step from the latest REQUESTED zoom and scroll, not from stale layout.
  const zoomRef = useRef(zoom);
  const renderedZoom = useRef(zoom);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const pendingScroll = useRef<ScrollPosition | null>(null);

  useLayoutEffect(() => {
    renderedZoom.current = zoom;
    applyPendingScroll(viewportRef.current, pendingScroll);
  }, [zoom]);

  function zoomTo(value: number, anchor?: ClientPoint): void {
    const previous = zoomRef.current;
    const next = clampPreviewZoom(value, rangeRef.current);
    if (!Number.isFinite(next) || next === previous) return;
    const viewport = viewportRef.current;
    if (viewport !== null) {
      // Capture before shrinking the stage: the browser may clamp its current
      // scroll offset during layout, losing the previous inspection point.
      pendingScroll.current = anchoredScroll(viewport, pendingScroll.current, anchor, {
        previous,
        next,
      });
    }
    zoomRef.current = next;
    setZoom(next);
    // Steps that return to the committed zoom before React re-renders leave no
    // commit to wait for; the stage already has this size.
    if (next === renderedZoom.current) applyPendingScroll(viewport, pendingScroll);
  }

  function panBy(dx: number, dy: number): void {
    const viewport = viewportRef.current;
    if (viewport === null || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const pending = pendingScroll.current;
    if (pending !== null) {
      pendingScroll.current = { left: pending.left + dx, top: pending.top + dy };
      return;
    }
    viewport.scrollLeft += dx;
    viewport.scrollTop += dy;
  }

  return {
    zoom,
    range,
    viewportRef,
    zoomTo,
    zoomBy: (factor, anchor) => zoomTo(zoomRef.current * factor, anchor),
    panBy,
  };
}

function applyPendingScroll(
  viewport: HTMLDivElement | null,
  pending: React.MutableRefObject<ScrollPosition | null>,
): void {
  const target = pending.current;
  if (viewport === null || target === null) return;
  viewport.scrollLeft = target.left;
  viewport.scrollTop = target.top;
  pending.current = null;
}

function anchoredScroll(
  viewport: HTMLDivElement,
  pending: ScrollPosition | null,
  anchor: ClientPoint | undefined,
  zoom: { readonly previous: number; readonly next: number },
): ScrollPosition {
  const from = pending ?? { left: viewport.scrollLeft, top: viewport.scrollTop };
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  let x = width / 2;
  let y = height / 2;
  if (anchor !== undefined) {
    const rect = viewport.getBoundingClientRect();
    x = anchor.clientX - rect.left - viewport.clientLeft;
    y = anchor.clientY - rect.top - viewport.clientTop;
  }
  return {
    left: anchoredScrollOffset({ scroll: from.left, anchor: x, size: width, ...zoom }),
    top: anchoredScrollOffset({ scroll: from.top, anchor: y, size: height, ...zoom }),
  };
}

function useViewportSize(viewportRef: React.RefObject<HTMLDivElement>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return undefined;
    const measure = (): void => {
      const next = { width: viewport.clientWidth, height: viewport.clientHeight };
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportRef]);
  return size;
}
