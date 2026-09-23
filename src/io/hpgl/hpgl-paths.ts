import type { Polyline, Vec2 } from '../../core/scene';
import {
  finitePoint,
  HPGL_IMPORT_LIMITS,
  HpglError,
  note,
  reservePoints,
  type HpglState,
} from './hpgl-types';

export function equalPoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

export function movePlotterPoint(state: HpglState, point: Vec2, countWork = true): void {
  finitePoint(point, state.command);
  if (countWork) reservePoints(state, 1);
  if (state.polygonMode) {
    if (state.contour === null) state.contour = { points: [point], down: [false] };
    else {
      state.contour.points.push(point);
      state.contour.down.push(state.down);
    }
  } else if (state.down && state.pen !== 0) {
    state.active ??= { pen: state.pen, points: [state.position] };
    state.active.points.push(point);
  } else {
    flushStroke(state);
    if (state.down)
      note(state, 'unselected-pen', 'Drawing with no selected pen (SP0) is omitted, as in HPGL.');
  }
  state.position = point;
}

export function flushStroke(state: HpglState): void {
  if (state.active === null) return;
  const { points } = state.active;
  state.active = null;
  if (points.length < 2) return;
  emitPolylines(state, [closedPolyline(points)]);
}

export function closedPolyline(points: readonly Vec2[]): Polyline {
  const first = points[0];
  const last = points[points.length - 1];
  const closed =
    points.length > 2 && first !== undefined && last !== undefined && equalPoint(first, last);
  return { points: closed ? points.slice(0, -1) : points, closed };
}

export function emitPolylines(
  state: HpglState,
  polylines: readonly Polyline[],
  fillRule?: 'evenodd' | 'nonzero',
): void {
  if (polylines.length === 0) return;
  if (state.pen === 0) {
    note(state, 'unselected-pen', 'Drawing with no selected pen (SP0) is omitted, as in HPGL.');
    return;
  }
  const usable = polylines.filter((line) => line.points.length >= 2);
  if (usable.length === 0) return;
  for (const line of usable) state.outputPoints += line.points.length;
  if (
    state.outputPoints > HPGL_IMPORT_LIMITS.points ||
    state.paths.length >= HPGL_IMPORT_LIMITS.paths
  ) {
    throw new HpglError(
      'limit-exceeded',
      'Expanded geometry exceeds the HPGL import point/path budget.',
      state.command,
    );
  }
  state.paths.push({
    pen: state.pen,
    polylines: usable,
    ...(fillRule === undefined ? {} : { fillRule }),
  });
  if (state.pen > 1)
    note(
      state,
      'pen-palette',
      'Pen numbers use distinct display colours; the file does not define the physical plotter palette.',
    );
  if (fillRule !== undefined)
    note(
      state,
      'fill-boundaries',
      'Filled shapes were imported as boundaries with their fill rule. Choose a Fill operation to engrave their interiors.',
    );
}
