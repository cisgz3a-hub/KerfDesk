// Greedy line/arc fitting over one run of sampled source (ADR-407).
//
// A smooth run carries a unit tangent on each side of every sample. Each step
// starts at the last break point and takes, among four candidates, the one
// that covers the most samples per emitted move (ties keep the simpler one):
//   - a straight chord, wherever it stays within the bound and arrives within
//     ARC_FIT_MAX_CHORD_TANGENT_DEG of the source tangent;
//   - one arc leaving along the source tangent, arriving within
//     ARC_FIT_MAX_KINK_DEG of the source tangent;
//   - one arc through both ends, its centre the best fit to the samples
//     between, meeting both source tangents within that kink;
//   - a biarc matching both source tangents exactly (one or two moves).
// Arcs therefore meet each other at a smooth source point with a turn of at
// most twice the kink, and not at all at a biarc's ends. Every candidate must
// also leave the move before it with a turn under ARC_FIT_CORNER_DEG, so no
// sharp joint appears where the source is smooth (short of a feature finer
// than the sampling, where the source's own sample chord is the fallback). A
// chord is taken only where it covers more of the run per move than any arc,
// as compile's own chords do everywhere today.
//
// A straight-segment run has no tangents: its vertices are the source. Each
// step takes a line or an arc through its two ends whose centre best fits the
// vertices between, whichever reaches farther. Either, when it spans several
// source vertices, must meet the move before it under the corner angle, as
// the source vertices inside a run do; the source edge itself always may.
//
// The fitted centre is Kasa's algebraic least-squares circle ("A circle
// fitting procedure and its error analysis", IEEE Trans. Instrum. Meas.
// IM-25(1):8-14, 1976) constrained to the ends' perpendicular bisector, which
// makes it linear in one unknown; the circle through the two ends and the
// middle sample is tried when that one does not fit. Every candidate passes
// the exact two-sided check in arc-piece-check.ts.

import type { Vec2 } from '../../scene';
import { primitiveFitsPiece } from './arc-piece-check';
import {
  arcAbout,
  arcLeavingAlong,
  fitLine,
  primitiveEndTangent,
  primitiveStartTangent,
  type FitPrimitive,
} from './arc-primitives';
import { biarcBetween, biarcFitsPiece } from './biarc';
import { mergeCocircular } from './merge-cocircular';
import {
  ARC_FIT_CORNER_DEG,
  ARC_FIT_MAX_CHORD_TANGENT_DEG,
  ARC_FIT_MAX_KINK_DEG,
} from './arc-fit-limits';

export type SmoothRun = {
  readonly points: ReadonlyArray<Vec2>;
  /** Unit tangent arriving at each sample. */
  readonly tangentsIn: ReadonlyArray<Vec2>;
  /** Unit tangent leaving each sample. */
  readonly tangentsOut: ReadonlyArray<Vec2>;
};

const COS_KINK = Math.cos((ARC_FIT_MAX_KINK_DEG * Math.PI) / 180);
const COS_CHORD_TANGENT = Math.cos((ARC_FIT_MAX_CHORD_TANGENT_DEG * Math.PI) / 180);
const COS_CORNER = Math.cos((ARC_FIT_CORNER_DEG * Math.PI) / 180);

// Whether a move starting with `primitive` meets the one before it (whose end
// tangent is `previousEnd`) with a turn under the corner angle.
function joinsBelowCorner(previousEnd: Vec2 | null, primitive: FitPrimitive | undefined): boolean {
  return (
    previousEnd === null ||
    primitive === undefined ||
    dot(previousEnd, primitiveStartTangent(primitive)) > COS_CORNER
  );
}

function endTangentOf(primitives: ReadonlyArray<FitPrimitive>): Vec2 | null {
  const last = primitives[primitives.length - 1];
  return last === undefined ? null : primitiveEndTangent(last);
}

export function fitSmoothRun(run: SmoothRun, toleranceMm: number): FitPrimitive[] {
  const last = run.points.length - 1;
  const out: FitPrimitive[] = [];
  let i = 0;
  let previousEnd: Vec2 | null = null;
  while (i < last) {
    const step = bestSmoothStep(run, i, toleranceMm, previousEnd);
    out.push(...step.primitives);
    previousEnd = endTangentOf(step.primitives) ?? previousEnd;
    i = step.end;
  }
  return mergeCocircular(out);
}

type Step = { readonly end: number; readonly primitives: ReadonlyArray<FitPrimitive> };
type Candidate = (end: number) => FitPrimitive[] | null;

function bestSmoothStep(
  run: SmoothRun,
  i: number,
  toleranceMm: number,
  previousEnd: Vec2 | null,
): Step {
  const last = run.points.length - 1;
  const start = run.points[i] as Vec2;
  let best: Step = { end: i + 1, primitives: [fitLine(start, run.points[i + 1] as Vec2)] };
  let bestCoverage = 1;
  for (const raw of smoothCandidates(run, i, toleranceMm)) {
    const candidate: Candidate = (j) => {
      const primitives = raw(j);
      return primitives !== null && joinsBelowCorner(previousEnd, primitives[0])
        ? primitives
        : null;
    };
    const reach = farthestReach(i, last, 1, (j) => candidate(j) !== null);
    const primitives = reach < 0 ? null : candidate(reach);
    if (primitives === null || primitives.length === 0) continue;
    const coverage = (reach - i) / primitives.length;
    if (coverage > bestCoverage) {
      best = { end: reach, primitives };
      bestCoverage = coverage;
    }
  }
  return best;
}

function smoothCandidates(run: SmoothRun, i: number, toleranceMm: number): Candidate[] {
  const { points, tangentsIn, tangentsOut } = run;
  const start = points[i] as Vec2;
  const leaving = tangentsOut[i] as Vec2;
  const fits = (primitive: FitPrimitive, j: number): boolean =>
    primitiveFitsPiece(primitive, { points, from: i, to: j }, toleranceMm);
  const smoothEnds = (primitive: FitPrimitive, j: number): boolean =>
    dot(primitiveStartTangent(primitive), leaving) >= COS_KINK &&
    dot(primitiveEndTangent(primitive), tangentsIn[j] as Vec2) >= COS_KINK;
  // A chord must arrive within ARC_FIT_MAX_CHORD_TANGENT_DEG of the source
  // tangent, so whatever follows (an arc within the kink, another chord, the
  // source's own sample chord) can meet it under the corner angle; how it
  // leaves is judged by the actual joint with the move before
  // (joinsBelowCorner in bestSmoothStep).
  const chordMeetsTangents = (line: FitPrimitive, j: number): boolean =>
    dot(primitiveEndTangent(line), tangentsIn[j] as Vec2) >= COS_CHORD_TANGENT;
  return [
    (j) => {
      const line = fitLine(start, points[j] as Vec2);
      return chordMeetsTangents(line, j) && fits(line, j) ? [line] : null;
    },
    (j) => {
      const arc = arcLeavingAlong(start, leaving, points[j] as Vec2);
      return arc !== null && arc.kind === 'arc' && smoothEnds(arc, j) && fits(arc, j)
        ? [arc]
        : null;
    },
    (j) => {
      const arc = j - i < 2 ? null : fittedArcThrough(points, i, j, toleranceMm);
      return arc !== null && smoothEnds(arc, j) ? [arc] : null;
    },
    (j) => {
      const biarc = biarcBetween(start, leaving, points[j] as Vec2, tangentsIn[j] as Vec2);
      return biarc !== null && biarcFitsPiece(biarc, points, i, j, toleranceMm)
        ? mergeCocircular([biarc.first, biarc.second])
        : null;
    },
  ];
}

export function fitStraightRun(vertices: ReadonlyArray<Vec2>, toleranceMm: number): FitPrimitive[] {
  const last = vertices.length - 1;
  const out: FitPrimitive[] = [];
  let i = 0;
  let previousEnd: Vec2 | null = null;
  while (i < last) {
    const start = vertices[i] as Vec2;
    const from = i;
    const joined = previousEnd;
    // The source edge itself is always a move; anything longer must meet the
    // move before it under the corner angle, as the source vertices do.
    const lineAt = (j: number): FitPrimitive | null => {
      const line = fitLine(start, vertices[j] as Vec2);
      if (from + 1 === j) return line;
      const piece = { points: vertices, from, to: j };
      return joinsBelowCorner(joined, line) && primitiveFitsPiece(line, piece, toleranceMm)
        ? line
        : null;
    };
    const arcAt = (j: number): FitPrimitive | null => {
      const arc = fittedArcThrough(vertices, from, j, toleranceMm);
      return arc !== null && joinsBelowCorner(joined, arc) ? arc : null;
    };
    const lineReach = farthestReach(i, last, 1, (j) => lineAt(j) !== null);
    const arcReach = farthestReach(i, last, 2, (j) => arcAt(j) !== null);
    const useArc = arcReach > lineReach;
    const primitive = (useArc ? arcAt(arcReach) : lineAt(lineReach)) as FitPrimitive;
    out.push(primitive);
    previousEnd = primitiveEndTangent(primitive);
    i = useArc ? arcReach : lineReach;
  }
  return out;
}

/**
 * The largest end index in [start + minSpan, last] the predicate accepts,
 * found by galloping then bisecting (the acceptance is close to monotone in
 * the end index; the result is always an accepted index), or -1.
 */
export function farthestReach(
  start: number,
  last: number,
  minSpan: number,
  accepts: (end: number) => boolean,
): number {
  let good = -1;
  let span = minSpan;
  let probe = start + span;
  while (probe <= last && accepts(probe)) {
    good = probe;
    span *= 2;
    probe = start + span;
  }
  if (good < 0) return -1;
  let bad = probe;
  if (probe > last) {
    if (good === last) return good;
    if (accepts(last)) return last;
    bad = last;
  }
  while (bad - good > 1) {
    const mid = Math.floor((good + bad) / 2);
    if (accepts(mid)) good = mid;
    else bad = mid;
  }
  return good;
}

function fittedArcThrough(
  points: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  toleranceMm: number,
): FitPrimitive | null {
  const start = points[from] as Vec2;
  const end = points[to] as Vec2;
  const middle = points[Math.floor((from + to) / 2)] as Vec2;
  const centers = [bisectorLeastSquaresCenter(points, from, to), circumcenter(start, middle, end)];
  for (const center of centers) {
    if (center === null) continue;
    const clockwise =
      (start.x - center.x) * (middle.y - center.y) - (start.y - center.y) * (middle.x - center.x) <
      0;
    const arc = arcAbout(start, end, center, clockwise);
    if (arc !== null && primitiveFitsPiece(arc, { points, from, to }, toleranceMm)) return arc;
  }
  return null;
}

// Centre M + s N on the ends' perpendicular bisector minimising the algebraic
// residuals |p - C|^2 - r^2 = |p - M|^2 - (c/2)^2 - 2 s (p - M).N, linear in s.
function bisectorLeastSquaresCenter(
  points: ReadonlyArray<Vec2>,
  from: number,
  to: number,
): Vec2 | null {
  const start = points[from] as Vec2;
  const end = points[to] as Vec2;
  const cx = end.x - start.x;
  const cy = end.y - start.y;
  const chord = Math.hypot(cx, cy);
  if (!(chord > 0)) return null;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const nx = -cy / chord;
  const ny = cx / chord;
  const halfSq = (chord / 2) ** 2;
  let ab = 0;
  let bb = 0;
  for (let index = from + 1; index < to; index += 1) {
    const qx = (points[index] as Vec2).x - mx;
    const qy = (points[index] as Vec2).y - my;
    const a = qx * qx + qy * qy - halfSq;
    const b = 2 * (qx * nx + qy * ny);
    ab += a * b;
    bb += b * b;
  }
  if (!(bb > 0)) return null;
  const s = ab / bb;
  return { x: mx + s * nx, y: my + s * ny };
}

function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (d === 0 || !Number.isFinite(d)) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}
