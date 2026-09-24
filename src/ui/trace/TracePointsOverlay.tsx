import { useEffect, useRef } from 'react';
import type { ColoredPath } from '../../core/scene';
import {
  paintTracePoints,
  tracePointsBitmapSize,
  type TracePointsWindow,
} from './trace-points-canvas';

type Props = {
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly width: number;
  readonly height: number;
};

/** Keep point inspection independent of React's per-node reconciliation. */
export function TracePointsOverlay(props: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { paths, width, height } = props;
  useEffect(() => {
    const canvas = canvasRef.current;
    const artwork = canvas?.parentElement;
    const viewport = canvas?.closest<HTMLElement>('.lf-trace-preview__viewport');
    if (canvas === null || artwork == null || viewport == null) return undefined;
    let pending = 0;
    const paint = (): void => {
      pending = 0;
      paintVisiblePoints(canvas, artwork, viewport, { paths, width, height });
    };
    const schedule = (): void => {
      if (pending === 0) pending = requestAnimationFrame(paint);
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(artwork);
    observer?.observe(viewport);
    viewport.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(pending);
      observer?.disconnect();
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [paths, width, height]);
  return (
    <canvas
      ref={canvasRef}
      className="lf-trace-preview__points"
      role="img"
      aria-label="Trace points"
    />
  );
}

function paintVisiblePoints(
  canvas: HTMLCanvasElement,
  artwork: HTMLElement,
  viewport: HTMLElement,
  props: Props,
): void {
  const rect = artwork.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || props.width <= 0 || props.height <= 0) return;
  const scaleX = rect.width / props.width;
  const scaleY = rect.height / props.height;
  const left = Math.max(frame.left + viewport.clientLeft, rect.left - 2.1 * scaleX);
  const top = Math.max(frame.top + viewport.clientTop, rect.top - 2.1 * scaleY);
  const right = Math.min(
    frame.left + viewport.clientLeft + viewport.clientWidth,
    rect.right + 2.1 * scaleX,
  );
  const bottom = Math.min(
    frame.top + viewport.clientTop + viewport.clientHeight,
    rect.bottom + 2.1 * scaleY,
  );
  const view: TracePointsWindow = {
    left: left - rect.left,
    top: top - rect.top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    scaleX,
    scaleY,
  };
  const size = tracePointsBitmapSize(view.width, view.height, window.devicePixelRatio || 1);
  canvas.width = size.width;
  canvas.height = size.height;
  Object.assign(canvas.style, {
    left: `${view.left}px`,
    top: `${view.top}px`,
    width: `${view.width}px`,
    height: `${view.height}px`,
    right: 'auto',
    bottom: 'auto',
  });
  const context = canvas.getContext('2d');
  if (context === null || view.width === 0 || view.height === 0) return;
  paintTracePoints(
    context,
    props.paths,
    view,
    size.ratio,
    getComputedStyle(canvas).getPropertyValue('--lf-accent').trim(),
  );
}
