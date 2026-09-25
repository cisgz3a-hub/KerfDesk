import type { Vec2 } from '../../core/scene';
import { HpglError, requireArgs, reservePoints, type HpglState } from './hpgl-types';
import { plotterPoint, userPoint } from './hpgl-scaling';
import { closedPolyline, emitPolylines, flushStroke, movePlotterPoint } from './hpgl-paths';
import { closeContour } from './hpgl-polygons';

export function drawArc(state: HpglState): void {
  requireArgs(state.command, [3, 4]);
  const start = userPoint(state);
  const [x = 0, y = 0, sweep = 0, chord = 5] = state.command.values;
  const relative = state.command.name === 'AR';
  const center = { x: relative ? start.x + x : x, y: relative ? start.y + y : y };
  const points = arcPoints(
    state,
    center,
    { x: start.x - center.x, y: start.y - center.y },
    sweep,
    chord,
  );
  if (sweep % 360 === 0) points[points.length - 1] = state.position;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point !== undefined) movePlotterPoint(state, point, false);
  }
}

export function drawCircle(state: HpglState): void {
  requireArgs(state.command, [1, 2]);
  const [radius = 0, chord = 5] = state.command.values;
  if (radius === 0)
    throw new HpglError(
      'invalid-geometry',
      'A zero-radius circle has no importable boundary.',
      state.command,
    );
  flushStroke(state);
  if (state.polygonMode) closeContour(state);
  const center = userPoint(state);
  const points = arcPoints(state, center, { x: radius, y: 0 }, 360, chord);
  // Close exactly, without a floating-point seam at the circle start.
  const first = points[0];
  if (first !== undefined) points[points.length - 1] = first;
  if (state.polygonMode)
    state.polygon.push({ points, down: points.map((_, index) => index !== 0) });
  else emitPolylines(state, [closedPolyline(points)]);
}

function arcPoints(
  state: HpglState,
  center: Vec2,
  radius: Vec2,
  sweep: number,
  chord: number,
): Vec2[] {
  if (chord < 0.5 || chord > 180 || sweep < -32768 || sweep > 32767) {
    throw new HpglError(
      'invalid-parameters',
      'Arc chord angles must be 0.5–180 degrees and sweeps −32768–32767 degrees.',
      state.command,
    );
  }
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / chord));
  reservePoints(state, steps + 1);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const { x: cos, y: sin } = unitVector((sweep * index) / steps);
    return plotterPoint(state, {
      x: center.x + radius.x * cos - radius.y * sin,
      y: center.y + radius.x * sin + radius.y * cos,
    });
  });
}

function unitVector(degrees: number): Vec2 {
  const normalized = ((degrees % 360) + 360) % 360;
  switch (normalized) {
    case 0:
      return { x: 1, y: 0 };
    case 90:
      return { x: 0, y: 1 };
    case 180:
      return { x: -1, y: 0 };
    case 270:
      return { x: 0, y: -1 };
    default: {
      const radians = (normalized * Math.PI) / 180;
      return { x: Math.cos(radians), y: Math.sin(radians) };
    }
  }
}
