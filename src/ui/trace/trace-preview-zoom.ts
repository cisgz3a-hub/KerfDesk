import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  TracePreviewZoomEngine,
  type ClientPoint,
  type ZoomMode,
} from './trace-preview-zoom-engine';
import {
  MIN_PREVIEW_ZOOM,
  previewZoomRange,
  type PreviewZoomRange,
} from './trace-preview-zoom-math';

export { LIVE_ZOOM_SETTLE_MS, type ClientPoint, type ZoomMode } from './trace-preview-zoom-engine';

type Size = { readonly width: number; readonly height: number };

export type TracePreviewZoom = {
  readonly zoom: number;
  readonly range: PreviewZoomRange;
  readonly viewportRef: React.RefObject<HTMLDivElement>;
  /** The artwork layer that a live gesture scales before the stage re-lays. */
  readonly lensRef: React.RefObject<HTMLDivElement>;
  /**
   * Zoom about `anchor`, or about the viewport centre when omitted. Returns
   * whether the zoom changed (false at a range limit).
   */
  readonly zoomTo: (value: number, anchor?: ClientPoint, mode?: ZoomMode) => boolean;
  readonly zoomBy: (factor: number, anchor?: ClientPoint, mode?: ZoomMode) => boolean;
  /** Scroll the view by screen pixels (positive reveals content to the right/below). */
  readonly panBy: (dx: number, dy: number) => void;
  /** Re-lay a live gesture's zoom now (before a Boundary drag, say). */
  readonly settle: () => void;
};

// Zoom is relative to the fitted image, not its native pixel size. Both stage
// dimensions scale together, so contain/meet and boundary coordinates agree.
// Zoom and pan are local viewing state only: nothing here reaches the trace.
// See TracePreviewZoomEngine for the live (wheel/pinch) versus commit paths.
export function useTracePreviewZoom(image?: Size): TracePreviewZoom {
  const [zoom, setZoom] = useState(MIN_PREVIEW_ZOOM);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TracePreviewZoomEngine | null>(null);
  engineRef.current ??= new TracePreviewZoomEngine(viewportRef, lensRef, setZoom);
  const engine = engineRef.current;
  const range = previewZoomRange(image, useViewportSize(viewportRef));
  engine.range = range;

  useLayoutEffect(() => engine.onLaidOut(zoom), [engine, zoom]);
  useEffect(() => () => engine.dispose(), [engine]);
  // The range follows the measured viewport and image. When it moves (window
  // resize, side-by-side to stacked layout, a new image), pull a zoom left
  // outside it back to the nearest limit, about the centre of the view.
  useLayoutEffect(() => engine.reclamp(), [engine, range.min, range.max]);

  return {
    zoom,
    range,
    viewportRef,
    lensRef,
    zoomTo: (value, anchor, mode) => engine.zoomTo(value, anchor, mode),
    zoomBy: (factor, anchor, mode) => engine.zoomTo(engine.requestedZoom * factor, anchor, mode),
    panBy: (dx, dy) => engine.panBy(dx, dy),
    settle: () => engine.settle(),
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
