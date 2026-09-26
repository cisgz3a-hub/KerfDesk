// fitArcMoves at tolerances at or below the fixed part of the ADR-432 budget
// (source sampling 0.001 mm + emit rounding 0.002 mm). The fit's share of the
// bound is then zero or negative, and the fitter must either honour the
// tolerance or decline to the sampled source; it must never merge source
// points into a move that strays past the tolerance, or emit a non-finite one.

import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath, type CurveSubpath, type Vec2 } from '../../scene';
import { ARC_FIT_SOURCE_SAMPLE_ERROR_MM } from './arc-fit-limits';
import { sampleArcMoves, type ArcMove } from './arc-moves';
import { fitArcMoves } from './fit-arc-moves';
import type { ArcFitPlacement } from './mapped-pieces';

const IDENTITY: ArcFitPlacement = { map: (point) => point, largestScale: 1 };
const TINY_TOLERANCES_MM = [0.003, 0.001, 1e-6];
// The oracle flattens the canonical curve to this; it can misjudge by as much.
const ORACLE_MM = 1e-4;

function distanceToPolyline(point: Vec2, polyline: ReadonlyArray<Vec2>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    const a = polyline[index - 1] as Vec2;
    const b = polyline[index] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq > 0
        ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
        : 0;
    best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return best;
}

// Two-sided distance between the canonical curve and the fitted moves.
function hausdorff(curve: CurveSubpath, moves: ReadonlyArray<ArcMove>): number {
  const flattened = flattenCurveSubpath(curve, { toleranceMm: ORACLE_MM });
  if (flattened.kind !== 'ok') throw new Error('flatten failed');
  const source = [...flattened.polyline.points];
  const fitted = sampleArcMoves(curve.start, moves, ORACLE_MM);
  let worst = 0;
  for (const point of fitted) worst = Math.max(worst, distanceToPolyline(point, source));
  for (const point of source) worst = Math.max(worst, distanceToPolyline(point, fitted));
  return worst;
}

function allFinite(moves: ReadonlyArray<ArcMove>): boolean {
  return moves.every(
    (move) =>
      Number.isFinite(move.to.x) &&
      Number.isFinite(move.to.y) &&
      (move.kind === 'line' || (Number.isFinite(move.center.x) && Number.isFinite(move.center.y))),
  );
}

// A straight run whose middle vertex sits 0.0015 mm off the chord of its ends.
const BUMPED_LINE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 5, y: 0.0015 } },
    { kind: 'line', to: { x: 10, y: 0 } },
  ],
  closed: false,
};

// A smooth run: a cubic bulging 0.0015 mm off the chord of its ends.
const SHALLOW_CUBIC: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 10 / 3, y: 0.002 },
      control2: { x: 20 / 3, y: 0.002 },
      to: { x: 10, y: 0 },
    },
  ],
  closed: false,
};

describe('fitArcMoves at a tolerance the fixed budget already spends', () => {
  it.each(TINY_TOLERANCES_MM)('keeps a straight run within %f mm', (toleranceMm) => {
    const moves = fitArcMoves(BUMPED_LINE, IDENTITY, toleranceMm);
    expect(allFinite(moves)).toBe(true);
    // The source is a polyline, so declining to its own edges is exact.
    expect(hausdorff(BUMPED_LINE, moves)).toBeLessThanOrEqual(toleranceMm);
    expect(moves.map((move) => move.to)).toEqual([
      { x: 5, y: 0.0015 },
      { x: 10, y: 0 },
    ]);
  });

  it.each(TINY_TOLERANCES_MM)('keeps a smooth run to its samples at %f mm', (toleranceMm) => {
    const moves = fitArcMoves(SHALLOW_CUBIC, IDENTITY, toleranceMm);
    expect(allFinite(moves)).toBe(true);
    expect(moves.every((move) => move.kind === 'line')).toBe(true);
    // Declining leaves the sampled source, whose own error is the floor.
    const bound = Math.max(toleranceMm, ARC_FIT_SOURCE_SAMPLE_ERROR_MM) + ORACLE_MM;
    expect(hausdorff(SHALLOW_CUBIC, moves)).toBeLessThanOrEqual(bound);
  });
});
