import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath, type CurveSubpath, type Vec2 } from '../../scene';
import { fitArcMoves } from './fit-arc-moves';
import { sampleArcMoves, type ArcMove } from './arc-moves';
import type { ArcFitPlacement } from './mapped-pieces';

const TOLERANCE_MM = 0.025;
const IDENTITY: ArcFitPlacement = { map: (point) => point, largestScale: 1 };
// Circle quadrants as cubics: handle length 4/3 tan(pi/8) of the radius.
const KAPPA = (4 / 3) * Math.tan(Math.PI / 8);

function circleCubics(cx: number, cy: number, r: number): CurveSubpath {
  const k = KAPPA * r;
  return {
    start: { x: cx + r, y: cy },
    segments: [
      {
        kind: 'cubic',
        control1: { x: cx + r, y: cy + k },
        control2: { x: cx + k, y: cy + r },
        to: { x: cx, y: cy + r },
      },
      {
        kind: 'cubic',
        control1: { x: cx - k, y: cy + r },
        control2: { x: cx - r, y: cy + k },
        to: { x: cx - r, y: cy },
      },
      {
        kind: 'cubic',
        control1: { x: cx - r, y: cy - k },
        control2: { x: cx - k, y: cy - r },
        to: { x: cx, y: cy - r },
      },
      {
        kind: 'cubic',
        control1: { x: cx + k, y: cy - r },
        control2: { x: cx + r, y: cy - k },
        to: { x: cx + r, y: cy },
      },
    ],
    closed: true,
  };
}

function polylineSubpath(points: ReadonlyArray<Vec2>, closed = false): CurveSubpath {
  return {
    start: points[0] as Vec2,
    segments: points.slice(1).map((to) => ({ kind: 'line' as const, to })),
    closed,
  };
}

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

// Independent oracle: both curves sampled to 0.1 um and compared point by point.
function hausdorff(curve: CurveSubpath, moves: ReadonlyArray<ArcMove>): number {
  const flattened = flattenCurveSubpath(curve, { toleranceMm: 1e-4 });
  if (flattened.kind !== 'ok') throw new Error('flatten failed');
  const source = [...flattened.polyline.points];
  if (curve.closed) source.push(curve.start);
  const fitted = sampleArcMoves(curve.start, moves, 1e-4);
  let worst = 0;
  for (const point of fitted) worst = Math.max(worst, distanceToPolyline(point, source));
  for (const point of source) worst = Math.max(worst, distanceToPolyline(point, fitted));
  return worst;
}

describe('fitArcMoves', () => {
  it('fits a cubic circle with arcs within the tolerance', () => {
    const circle = circleCubics(50, 40, 10);
    const moves = fitArcMoves(circle, IDENTITY, TOLERANCE_MM);
    expect(moves.filter((move) => move.kind === 'arc').length).toBeGreaterThanOrEqual(2);
    expect(moves.length).toBeLessThanOrEqual(4);
    expect(hausdorff(circle, moves)).toBeLessThanOrEqual(TOLERANCE_MM);
    expect(moves[moves.length - 1]?.to).toEqual({ x: 60, y: 40 });
  });

  it('turns a densely sampled polyline arc back into arcs', () => {
    const points = Array.from({ length: 91 }, (_, index) => {
      const angle = (index * Math.PI) / 90;
      return { x: 20 * Math.cos(angle), y: 20 * Math.sin(angle) };
    });
    const curve = polylineSubpath(points);
    const moves = fitArcMoves(curve, IDENTITY, TOLERANCE_MM);
    expect(moves.length).toBeLessThanOrEqual(3);
    expect(moves.some((move) => move.kind === 'arc')).toBe(true);
    expect(hausdorff(curve, moves)).toBeLessThanOrEqual(TOLERANCE_MM);
  });

  it('keeps corners as exact move ends and straight edges as lines', () => {
    const square = polylineSubpath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      true,
    );
    const moves = fitArcMoves(square, IDENTITY, TOLERANCE_MM);
    expect(moves).toEqual([
      { kind: 'line', to: { x: 10, y: 0 } },
      { kind: 'line', to: { x: 10, y: 10 } },
      { kind: 'line', to: { x: 0, y: 10 } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ]);
  });

  it('keeps a corner between two curves at its exact position', () => {
    const corner = { x: 10, y: 0 };
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'cubic', control1: { x: 3, y: 4 }, control2: { x: 7, y: 4 }, to: corner },
        {
          kind: 'cubic',
          control1: { x: 13, y: 4 },
          control2: { x: 17, y: 4 },
          to: { x: 20, y: 0 },
        },
      ],
      closed: false,
    };
    const moves = fitArcMoves(curve, IDENTITY, TOLERANCE_MM);
    expect(moves.some((move) => move.to.x === corner.x && move.to.y === corner.y)).toBe(true);
    expect(hausdorff(curve, moves)).toBeLessThanOrEqual(TOLERANCE_MM);
  });

  it('fits an S-curve within the tolerance under a mirrored, scaled placement', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 8, y: 12 },
          control2: { x: 12, y: -12 },
          to: { x: 20, y: 0 },
        },
      ],
      closed: false,
    };
    const placement: ArcFitPlacement = {
      map: (point) => ({ x: 3 * point.x + 5, y: 200 - 3 * point.y }),
      largestScale: 3,
    };
    const moves = fitArcMoves(curve, placement, TOLERANCE_MM);
    const mapped: CurveSubpath = {
      start: placement.map(curve.start),
      segments: [
        {
          kind: 'cubic',
          control1: placement.map({ x: 8, y: 12 }),
          control2: placement.map({ x: 12, y: -12 }),
          to: placement.map({ x: 20, y: 0 }),
        },
      ],
      closed: false,
    };
    expect(hausdorff(mapped, moves)).toBeLessThanOrEqual(TOLERANCE_MM);
    const chords = flattenCurveSubpath(mapped, { toleranceMm: TOLERANCE_MM });
    if (chords.kind !== 'ok') throw new Error('flatten failed');
    expect(moves.length).toBeLessThan(chords.segmentCount);
  });
});
