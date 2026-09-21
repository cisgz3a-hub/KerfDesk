/* eslint-disable no-restricted-syntax -- Scene preview ink colours; never machine output or UI chrome. */
import {
  SECOND_PASS_SEGMENTS_PER_CHUNK,
  type PreviewBounds,
  type SecondPassDrawing,
} from './second-pass-preview';
import type { CanvasSize, CanvasView } from './second-pass-canvas-view';

const DISPLAY_OPACITY_STEPS = 64;
const PATH_BATCH_SEGMENTS = 4096;
type SegmentVisitor = (ax: number, ay: number, bx: number, by: number, strength: number) => void;

function visibleBounds(view: CanvasView, size: CanvasSize): PreviewBounds {
  // Include the rendered stroke width and antialiasing fringe at the edges.
  const padding = (Math.max(0.8, view.scale * 0.08) / 2 + 1) / view.scale;
  return {
    minX: -view.x / view.scale - padding,
    minY: -view.y / view.scale - padding,
    maxX: (size.width - view.x) / view.scale + padding,
    maxY: (size.height - view.y) / view.scale + padding,
  };
}

function intersects(ax: number, ay: number, bx: number, by: number, view: PreviewBounds): boolean {
  return (
    Math.max(ax, bx) >= view.minX &&
    Math.min(ax, bx) <= view.maxX &&
    Math.max(ay, by) >= view.minY &&
    Math.min(ay, by) <= view.maxY
  );
}

/** Whole offscreen chunks are skipped before reading their segment values. */
export function visitVisibleSecondPassSegments(
  drawing: SecondPassDrawing,
  view: CanvasView,
  size: CanvasSize,
  visit: SegmentVisitor,
): void {
  const bounds = visibleBounds(view, size);
  const boxes = drawing.chunkBounds;
  for (let box = 0; box < boxes.length; box += 4) {
    const minX = boxes[box];
    const minY = boxes[box + 1];
    const maxX = boxes[box + 2];
    const maxY = boxes[box + 3];
    if (minX === undefined || minY === undefined || maxX === undefined || maxY === undefined)
      continue;
    if (!intersects(minX, minY, maxX, maxY, bounds)) continue;
    const start = (box / 4) * SECOND_PASS_SEGMENTS_PER_CHUNK * 5;
    visitChunk(drawing.segments, start, bounds, visit);
  }
}

function visitChunk(
  data: Float64Array,
  start: number,
  bounds: PreviewBounds,
  visit: SegmentVisitor,
): void {
  const end = Math.min(data.length, start + SECOND_PASS_SEGMENTS_PER_CHUNK * 5);
  for (let i = start; i < end; i += 5) {
    const ax = data[i];
    const ay = data[i + 1];
    const bx = data[i + 2];
    const by = data[i + 3];
    const strength = data[i + 4];
    if (
      ax === undefined ||
      ay === undefined ||
      bx === undefined ||
      by === undefined ||
      strength === undefined
    )
      continue;
    if (intersects(ax, ay, bx, by, bounds)) visit(ax, ay, bx, by, strength);
  }
}

function flushPaths(
  ctx: CanvasRenderingContext2D,
  paths: Array<Path2D | null>,
  opacity: number,
): void {
  for (let level = 1; level < paths.length; level += 1) {
    const path = paths[level];
    if (!path) continue;
    ctx.globalAlpha = (opacity * level) / DISPLAY_OPACITY_STEPS;
    ctx.stroke(path);
    paths[level] = null;
  }
}

/** Display-only opacity quantisation batches native canvas calls. Coordinates
 * remain binary64 and every visible segment is retained; machining is unchanged. */
export function drawSecondPassSegments(
  ctx: CanvasRenderingContext2D,
  drawing: SecondPassDrawing,
  view: CanvasView,
  size: CanvasSize,
  opacity: number,
  color = '#28201b',
): void {
  const paths: Array<Path2D | null> = Array.from({ length: DISPLAY_OPACITY_STEPS + 1 }, () => null);
  let pending = 0;
  ctx.lineWidth = Math.max(0.8, view.scale * 0.08);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  visitVisibleSecondPassSegments(drawing, view, size, (ax, ay, bx, by, strength) => {
    const level = Math.round(Math.min(1, Math.max(0.08, strength)) * DISPLAY_OPACITY_STEPS);
    const path = paths[level] ?? new Path2D();
    paths[level] = path;
    path.moveTo(ax * view.scale + view.x, ay * view.scale + view.y);
    path.lineTo(bx * view.scale + view.x, by * view.scale + view.y);
    pending += 1;
    if (pending >= PATH_BATCH_SEGMENTS) {
      flushPaths(ctx, paths, opacity);
      pending = 0;
    }
  });
  flushPaths(ctx, paths, opacity);
  ctx.globalAlpha = 1;
}
