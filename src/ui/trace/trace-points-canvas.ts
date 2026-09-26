import type { ColoredPath } from '../../core/scene';
import { TRACE_NODE_KINDS, traceNodes } from './trace-point-nodes';

const MAX_CANVAS_PIXELS = 4_194_304;
const MAX_CANVAS_EDGE = 4096;
const MARKER_RADIUS = 1.6;
// A corner square's half-side; its area roughly matches the round marker's.
const CORNER_HALF_SIDE = 1.4;
const MARKER_STROKE = 0.45;
const PAINT_BATCH = 512;
const CORNER_CODE = TRACE_NODE_KINDS.indexOf('corner');
const DENSITY_CELL_PX = 2;

export type TracePointsWindow = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
};

/** One viewport-sized bitmap, even when the artwork is zoomed far beyond it. */
export function tracePointsBitmapSize(
  width: number,
  height: number,
  deviceRatio: number,
): {
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
} {
  if (![width, height, deviceRatio].every((value) => Number.isFinite(value) && value > 0)) {
    return { width: 1, height: 1, ratio: 1 };
  }
  const ratio = Math.min(
    deviceRatio,
    MAX_CANVAS_EDGE / width,
    MAX_CANVAS_EDGE / height,
    Math.sqrt(MAX_CANVAS_PIXELS / width / height),
  );
  return {
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
    ratio,
  };
}

/** View-only node markers (trace-point-nodes.ts): squares for corner nodes,
 * circles for smooth nodes and for polyline samples of paths without curves.
 * Nearby screen overlaps share a marker; original coordinates remain
 * untouched. Bounded paint batches avoid building another enormous native
 * path for a dense photo. Returns the number of markers drawn. */
export function paintTracePoints(
  context: CanvasRenderingContext2D,
  paths: ReadonlyArray<ColoredPath>,
  view: TracePointsWindow,
  ratio: number,
  color: string,
): number {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(
    view.scaleX * ratio,
    0,
    0,
    view.scaleY * ratio,
    -view.left * ratio,
    -view.top * ratio,
  );
  context.fillStyle = color;
  // Point markers are judged against the light artwork surface (ADR-047).
  // eslint-disable-next-line no-restricted-syntax -- white outline belongs to the material-facing artwork markers (ADR-047).
  context.strokeStyle = '#ffffff';
  context.lineWidth = MARKER_STROKE;
  const cellSize = Math.max(DENSITY_CELL_PX, 1 / ratio);
  const columns = Math.ceil(view.width / cellSize) + 2;
  const rows = Math.ceil(view.height / cellSize) + 2;
  const occupied = new Uint8Array(columns * rows);
  const marginX = (MARKER_RADIUS + MARKER_STROKE) * view.scaleX;
  const marginY = (MARKER_RADIUS + MARKER_STROKE) * view.scaleY;
  let drawn = 0;
  const { count, coordinates, kinds } = traceNodes(paths);
  context.beginPath();
  for (let node = 0; node < count; node += 1) {
    const pointX = coordinates[node * 2] as number;
    const pointY = coordinates[node * 2 + 1] as number;
    const x = pointX * view.scaleX - view.left;
    const y = pointY * view.scaleY - view.top;
    if (!intersectsWindow(x, y, view, marginX, marginY)) continue;
    const column = Math.max(0, Math.min(columns - 1, Math.floor(x / cellSize) + 1));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(y / cellSize) + 1));
    const cell = row * columns + column;
    if (occupied[cell] !== 0) continue;
    occupied[cell] = 1;
    if (kinds[node] === CORNER_CODE) {
      context.rect(
        pointX - CORNER_HALF_SIDE,
        pointY - CORNER_HALF_SIDE,
        2 * CORNER_HALF_SIDE,
        2 * CORNER_HALF_SIDE,
      );
    } else {
      context.moveTo(pointX + MARKER_RADIUS, pointY);
      context.arc(pointX, pointY, MARKER_RADIUS, 0, 2 * Math.PI);
    }
    drawn += 1;
    if (drawn % PAINT_BATCH === 0) flushMarkers(context);
  }
  flushMarkers(context);
  return drawn;
}

function intersectsWindow(
  x: number,
  y: number,
  view: TracePointsWindow,
  marginX: number,
  marginY: number,
): boolean {
  return x >= -marginX && y >= -marginY && x <= view.width + marginX && y <= view.height + marginY;
}

function flushMarkers(context: CanvasRenderingContext2D): void {
  context.fill();
  context.stroke();
  context.beginPath();
}
