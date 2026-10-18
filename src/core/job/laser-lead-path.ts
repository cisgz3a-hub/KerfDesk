// The path of one laser lead (ADR-626). Pure geometry: given the point where
// the lead joins the cut, the cut's direction there and the unit normal
// pointing into the scrap, it returns the lead as points (what every output
// burns) and as line/arc moves (what an arc-capable GRBL machine may write as
// G2/G3 when the contour itself goes out as arcs, ADR-432).
//
// A lead-in ends on the join point heading along the cut; a lead-out starts on
// it heading along the cut. Either way it leaves the cut on the scrap side:
//   line: straight, meeting the cut at `angleDeg` (90 comes straight in);
//   arc:  tangent to the cut at the join, turning through `angleDeg`, of
//         radius length / angle, so its path is `lengthMm` long.
// The join point is copied bit for bit, so the lead splices onto the contour
// without a gap.

import { ARC_FIT_MAX_RADIUS_MM, ARC_FIT_MIN_RADIUS_MM, type ArcMove } from '../geometry/arc-fit';
import type { LaserLeadStyle, Vec2 } from '../scene';

export type LeadShape = {
  readonly style: LaserLeadStyle;
  readonly lengthMm: number;
  readonly angleDeg: number;
};

export type LeadJoin = {
  /** Where the lead meets the cut, exactly as the contour holds it. */
  readonly at: Vec2;
  /** Unit direction of the cut at `at`. */
  readonly tangent: Vec2;
  /** Unit normal at `at` pointing into the scrap. */
  readonly scrap: Vec2;
};

export type LeadPath = {
  /** In travel order: free end to `at` for a lead-in, `at` to free end for a lead-out. */
  readonly points: ReadonlyArray<Vec2>;
  /** The same path as moves from points[0], ending bit for bit on its last point. */
  readonly moves: ReadonlyArray<ArcMove>;
  /** Where the lead starts (lead-in) or stops (lead-out): the end in the scrap. */
  readonly freeEnd: Vec2;
};

export type LeadKind = 'in' | 'out';

const DEG = Math.PI / 180;
// Chord sag of a sampled lead arc: below what a beam or the preview shows.
const ARC_SAMPLE_SAGITTA_MM = 0.005;
// One arc move covers at most a quarter turn, far inside the fitter's 179 degrees.
const MAX_ARC_MOVE_RAD = Math.PI / 2;

export function leadPath(kind: LeadKind, join: LeadJoin, shape: LeadShape): LeadPath {
  return shape.style === 'line' ? lineLead(kind, join, shape) : arcLead(kind, join, shape);
}

function lineLead(kind: LeadKind, join: LeadJoin, shape: LeadShape): LeadPath {
  const { at, tangent, scrap } = join;
  const along = shape.lengthMm * Math.cos(shape.angleDeg * DEG);
  const across = shape.lengthMm * Math.sin(shape.angleDeg * DEG);
  const sign = kind === 'in' ? -1 : 1;
  const freeEnd = {
    x: at.x + sign * along * tangent.x + across * scrap.x,
    y: at.y + sign * along * tangent.y + across * scrap.y,
  };
  return kind === 'in'
    ? { points: [freeEnd, at], moves: [{ kind: 'line', to: at }], freeEnd }
    : { points: [at, freeEnd], moves: [{ kind: 'line', to: freeEnd }], freeEnd };
}

function arcLead(kind: LeadKind, join: LeadJoin, shape: LeadShape): LeadPath {
  const { at, tangent, scrap } = join;
  const sweep = shape.angleDeg * DEG;
  const radius = shape.lengthMm / sweep;
  const center = { x: at.x + radius * scrap.x, y: at.y + radius * scrap.y };
  const joinAngle = Math.atan2(at.y - center.y, at.x - center.x);
  // Counter-clockwise motion at the join heads along the +90 degree rotation
  // of the radial (-scrap); the arc turns the way that matches the cut.
  const counterClockwise = scrap.y * tangent.x - scrap.x * tangent.y > 0;
  const turn = counterClockwise ? 1 : -1;
  const from = kind === 'in' ? joinAngle - turn * sweep : joinAngle;
  const to = kind === 'in' ? joinAngle : joinAngle + turn * sweep;
  const points = sampleArc(center, radius, from, to);
  // The join is copied exactly; the free end is the sampled one.
  if (kind === 'in') points[points.length - 1] = at;
  else points[0] = at;
  const freeEnd = (kind === 'in' ? points[0] : points[points.length - 1]) as Vec2;
  const moves = arcMoves(points, center, radius, from, to, !counterClockwise);
  return { points, moves, freeEnd };
}

function sampleArc(center: Vec2, radius: number, from: number, to: number): Vec2[] {
  const span = to - from;
  const step =
    radius <= ARC_SAMPLE_SAGITTA_MM
      ? Math.PI / 2
      : 2 * Math.acos(1 - ARC_SAMPLE_SAGITTA_MM / radius);
  const count = Math.max(2, Math.ceil(Math.abs(span) / step));
  const points: Vec2[] = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = from + span * (index / count);
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return points;
}

// Arc moves of at most a quarter turn each, ending exactly on the path's last
// point; chords instead where the radius is outside what the arc fitter
// emits (ADR-432), so the moves always validate.
function arcMoves(
  points: ReadonlyArray<Vec2>,
  center: Vec2,
  radius: number,
  from: number,
  to: number,
  clockwise: boolean,
): ReadonlyArray<ArcMove> {
  const last = points[points.length - 1] as Vec2;
  if (radius < ARC_FIT_MIN_RADIUS_MM || radius > ARC_FIT_MAX_RADIUS_MM) {
    return points.slice(1).map((point): ArcMove => ({ kind: 'line', to: point }));
  }
  const count = Math.max(1, Math.ceil(Math.abs(to - from) / MAX_ARC_MOVE_RAD));
  const moves: ArcMove[] = [];
  for (let index = 1; index <= count; index += 1) {
    const angle = from + (to - from) * (index / count);
    const end =
      index === count
        ? last
        : { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
    moves.push({ kind: 'arc', to: end, center, clockwise });
  }
  return moves;
}
