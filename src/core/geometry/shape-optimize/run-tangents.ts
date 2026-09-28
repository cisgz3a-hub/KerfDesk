// The tangent at each point of a run, for the fitter of Optimize Shapes
// (LBG-T22). Each piece the fitter lays leaves along the tangent the one before
// it arrived with, so these tangents decide how far each piece can reach.
//
// Where the neighbouring points lie farther apart than the window (a smoothed
// run, or clean drawn artwork), the circle through a point and its two
// neighbours gives the tangent, exact on circular stretches and second-order
// accurate on uneven spacing. Where points crowd closer than the window — a
// dense, jittery source fitted without smoothing — the neighbours alone would
// point along the jitter, so the tangent is the best-fit line through the
// points within one window each side, which averages the jitter out.

import type { Vec2 } from '../../scene/scene-object';
import { unit } from '../arc-fit/arc-primitives';
import { spanDirection, type OutlineWindow } from './outline-window';

// Enough points to average jitter out; more only costs time.
const MAX_WINDOW_POINTS = 48;

/**
 * `points` runs from its first to its last point; a periodic run repeats its
 * first point at the end, and its first and last tangents are the same.
 */
export function runTangents(
  points: ReadonlyArray<Vec2>,
  periodic: boolean,
  windowMm: number,
): Vec2[] {
  const last = points.length - 1;
  const outline: OutlineWindow = {
    points: periodic ? points.slice(0, last) : points,
    closed: periodic,
  };
  const tangents: Vec2[] = [];
  for (let index = 0; index <= last; index += 1) {
    if (periodic && index === last) {
      tangents.push(tangents[0] as Vec2);
      continue;
    }
    tangents.push(
      crowded(outline, index, windowMm)
        ? spanDirection(outline, index, windowMm, MAX_WINDOW_POINTS)
        : circleTangentAt(points, periodic, index),
    );
  }
  return tangents;
}

function crowded(outline: OutlineWindow, index: number, windowMm: number): boolean {
  const { points, closed } = outline;
  const n = points.length;
  const point = points[index] as Vec2;
  const near = (other: number): boolean => {
    if (!closed && (other < 0 || other >= n)) return false;
    const neighbour = points[(other + n) % n] as Vec2;
    return (neighbour.x - point.x) ** 2 + (neighbour.y - point.y) ** 2 < windowMm * windowMm;
  };
  return near(index - 1) || near(index + 1);
}

function circleTangentAt(points: ReadonlyArray<Vec2>, periodic: boolean, index: number): Vec2 {
  const last = points.length - 1;
  const point = points[index] as Vec2;
  if (periodic) {
    const before = points[index === 0 ? last - 1 : index - 1] as Vec2;
    const after = points[index === last ? 1 : index + 1] as Vec2;
    return circleTangent(before, point, after, point);
  }
  if (last < 2)
    return unit(
      (points[last] as Vec2).x - (points[0] as Vec2).x,
      (points[last] as Vec2).y - (points[0] as Vec2).y,
    );
  const middle = Math.min(last - 1, Math.max(1, index));
  return circleTangent(
    points[middle - 1] as Vec2,
    points[middle] as Vec2,
    points[middle + 1] as Vec2,
    point,
  );
}

// The tangent at `at` of the circle through a, b and c, pointing from a
// towards c; the chord a-c where the three are in line. Worked relative to b,
// so far-off coordinates lose no precision.
function circleTangent(a: Vec2, b: Vec2, c: Vec2, at: Vec2): Vec2 {
  const chord = unit(c.x - a.x, c.y - a.y);
  const ax = a.x - b.x;
  const ay = a.y - b.y;
  const cx = c.x - b.x;
  const cy = c.y - b.y;
  const d = 2 * (cx * ay - ax * cy);
  const scale = Math.max(ax * ax + ay * ay, cx * cx + cy * cy);
  if (!(Math.abs(d) > 1e-12 * scale)) return chord;
  const a2 = ax * ax + ay * ay;
  const c2 = cx * cx + cy * cy;
  const centreX = b.x + (c2 * ay - a2 * cy) / d;
  const centreY = b.y + (a2 * cx - c2 * ax) / d;
  const tangent = unit(-(at.y - centreY), at.x - centreX);
  return tangent.x * chord.x + tangent.y * chord.y >= 0
    ? tangent
    : { x: -tangent.x, y: -tangent.y };
}
