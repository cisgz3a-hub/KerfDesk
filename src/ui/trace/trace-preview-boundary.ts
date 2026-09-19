import { useRef, useState } from 'react';

import { normalizeTraceBoundary, type TraceBoundary } from '../../core/trace/trace-boundary';
import { fitTracePreviewImage } from './trace-preview-image-space';

export type TracePreviewBoundaryProps = {
  readonly imageSize?: { readonly width: number; readonly height: number };
  readonly boundary?: TraceBoundary | null;
  readonly onBoundaryChange?: (boundary: TraceBoundary) => void;
};

type DragPoint = { readonly x: number; readonly y: number };
type StageMouseEvent = React.MouseEvent<HTMLDivElement>;

export function useTracePreviewBoundary(props: TracePreviewBoundaryProps): {
  readonly activeBoundary: TraceBoundary | null;
  readonly onMouseDown: (event: StageMouseEvent) => void;
  readonly onMouseMove: (event: StageMouseEvent) => void;
  readonly onMouseUp: (event: StageMouseEvent) => void;
  readonly onMouseLeave: () => void;
} {
  const dragStart = useRef<DragPoint | null>(null);
  const [draftBoundary, setDraftBoundary] = useState<TraceBoundary | null>(null);

  function cancelDrag(): void {
    dragStart.current = null;
    setDraftBoundary(null);
  }

  function onMouseDown(event: StageMouseEvent): void {
    if (event.button !== 0 || props.onBoundaryChange === undefined) return;
    const point = imagePointFromMouse(event, props.imageSize);
    if (point === null) return;
    dragStart.current = point;
    setDraftBoundary(boundaryFromPoints(point, point));
    event.preventDefault();
  }

  function onMouseMove(event: StageMouseEvent): void {
    if (dragStart.current === null) return;
    const point = imagePointFromMouse(event, props.imageSize);
    setDraftBoundary(point === null ? null : boundaryFromPoints(dragStart.current, point));
  }

  function onMouseUp(event: StageMouseEvent): void {
    const start = dragStart.current;
    const point = imagePointFromMouse(event, props.imageSize);
    cancelDrag();
    if (start === null || point === null || props.imageSize === undefined) return;
    const boundary = normalizeTraceBoundary(
      boundaryFromPoints(start, point),
      props.imageSize.width,
      props.imageSize.height,
    );
    if (boundary !== null) props.onBoundaryChange?.(boundary);
  }

  return {
    activeBoundary: draftBoundary ?? props.boundary ?? null,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave: cancelDrag,
  };
}

function boundaryFromPoints(a: DragPoint, b: DragPoint): TraceBoundary {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function imagePointFromMouse(
  event: StageMouseEvent,
  imageSize: TracePreviewBoundaryProps['imageSize'],
): DragPoint | null {
  if (imageSize === undefined) return null;
  // The event target includes zoom and scroll offsets. Use the same original
  // image fit as the artwork rectangle, rather than fitting the trace grid.
  const rect = event.currentTarget.getBoundingClientRect();
  const fit = fitTracePreviewImage(imageSize, rect.width, rect.height);
  if (fit === null) return null;
  const scale = Math.min(rect.width / imageSize.width, rect.height / imageSize.height);
  const left = rect.left + fit.left;
  const top = rect.top + fit.top;
  return {
    x: Math.max(0, Math.min(imageSize.width, (event.clientX - left) / scale)),
    y: Math.max(0, Math.min(imageSize.height, (event.clientY - top) / scale)),
  };
}
