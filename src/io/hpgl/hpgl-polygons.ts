import type { Polyline, Vec2 } from '../../core/scene';
import {
  HpglError,
  requireArgs,
  reservePoints,
  type HpglContour,
  type HpglState,
} from './hpgl-types';
import { closedPolyline, emitPolylines, equalPoint, flushStroke } from './hpgl-paths';
import { plotterPoint, userPoint } from './hpgl-scaling';

export function polygonMode(state: HpglState): void {
  requireArgs(state.command, [0, 1]);
  const mode = state.command.values[0] ?? 0;
  if (
    ![0, 1, 2].includes(mode) ||
    (mode !== 0 && !state.polygonMode) ||
    (mode === 0 && state.polygonMode)
  ) {
    throw new HpglError(
      'invalid-parameters',
      'Use PM0 to enter polygon mode, then PM1 or PM2 to close it.',
      state.command,
    );
  }
  flushStroke(state);
  if (mode === 0) {
    reservePoints(state, 1);
    state.polygonMode = true;
    state.polygon = [];
    state.contour = { points: [state.position], down: [false] };
    return;
  }
  closeContour(state);
  if (mode === 2) state.polygonMode = false;
}

/** Forced polygon closure also changes the current pen position (HP 21-14, 21-36). */
export function closeContour(state: HpglState): void {
  const contour = state.contour;
  state.contour = null;
  const first = contour?.points[0];
  if (contour === null || first === undefined) return;
  const last = contour.points[contour.points.length - 1];
  if (last !== undefined && !equalPoint(first, last)) {
    reservePoints(state, 1);
    contour.points.push(first);
    contour.down.push(state.down);
  }
  state.position = first;
  if (contour.points.length > 2) state.polygon.push(contour);
}

export function drawPolygon(state: HpglState, filled: boolean): void {
  requireArgs(state.command, filled ? [0, 1] : [0]);
  const method = state.command.values[0] ?? 0;
  if (filled && method !== 0 && method !== 1)
    throw new HpglError('invalid-parameters', 'FP fill method must be 0 or 1.', state.command);
  flushStroke(state);
  const lines = filled
    ? state.polygon.map((contour) => closedPolyline(contour.points))
    : state.polygon.flatMap(edgeLines);
  emitPolylines(state, lines, filled ? (method === 0 ? 'evenodd' : 'nonzero') : undefined);
}

function edgeLines(contour: HpglContour): Polyline[] {
  const lines: Polyline[] = [];
  let active: Vec2[] = [];
  for (let index = 1; index < contour.points.length; index += 1) {
    const previous = contour.points[index - 1];
    const point = contour.points[index];
    if (previous === undefined || point === undefined) continue;
    if (contour.down[index] === true) {
      if (active.length === 0) active.push(previous);
      active.push(point);
    } else if (active.length > 0) {
      lines.push(closedPolyline(active));
      active = [];
    }
  }
  if (active.length > 0) lines.push(closedPolyline(active));
  return lines;
}

export function rectangle(state: HpglState): void {
  requireArgs(state.command, [2]);
  const start = userPoint(state);
  const [x = 0, y = 0] = state.command.values;
  const relative = state.command.name === 'ER' || state.command.name === 'RR';
  const end = { x: relative ? start.x + x : x, y: relative ? start.y + y : y };
  const points = [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }, start].map(
    (point) => plotterPoint(state, point),
  );
  reservePoints(state, points.length);
  flushStroke(state);
  state.polygon = [{ points, down: [false, true, true, true, true] }];
  emitPolylines(
    state,
    [closedPolyline(points)],
    state.command.name.startsWith('R') ? 'evenodd' : undefined,
  );
}
