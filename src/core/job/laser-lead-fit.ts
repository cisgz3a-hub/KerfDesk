// Whether a laser lead fits where it is asked to go (ADR-626), and the
// longest lead on the shortening ladder that does. A lead fits when:
//   - it stays on the bed (when the program's bed position is known);
//   - it never crosses its own contour away from the join
//     (laser-lead-own-crossing.ts), and it leaves the contour and never comes
//     back toward it: walking out
//     from the join, it never comes nearer the contour than it already was
//     (within TOLERANCE_MM, and up to the clearance), and its free end, where
//     the start or stop mark lands, is on the scrap side and at least the
//     clearance away, or, for a lead too short to reach that far, 90% of the
//     way its own shape takes it into the scrap;
//   - away from the join it keeps the clearance from every other cut line,
//     including the uncut gaps of a tabbed or perforated outline, except
//     copies of its own contour (the same outline on another operation);
//   - its free end is inside exactly the closed contours that hold its own
//     contour, so it cannot end inside another part or past the hole or
//     sheet opening its contour sits in.
// Full length first, then shorter steps down to a quarter; null when none fit.

import { pointInPolygon } from '../geometry';
import { sampleArcMoves } from '../geometry/arc-fit';
import type { Vec2 } from '../scene';
import { extendBoundsByEmittedArcMoves } from './cut-arc-moves';
import type { JobBounds } from './job-bounds';
import type { LeadObstacles } from './laser-lead-obstacles';
import { crossesOwnContour } from './laser-lead-own-crossing';
import {
  ARC_SAMPLE_SAGITTA_MM,
  leadPath,
  type LeadJoin,
  type LeadKind,
  type LeadPath,
  type LeadShape,
} from './laser-lead-path';

export type LeadFitContext = {
  readonly obstacles: LeadObstacles;
  readonly ownLine: number;
  readonly ownRing: ReadonlyArray<Vec2>;
  /** The contour as it burns: its G2/G3 arcs sampled when it goes out as arcs,
   * else its chords. The crossing check reads this. */
  readonly ownBurn: ReadonlyArray<Vec2>;
  /** Lines and rings the lead ignores: its own contour and its copies. */
  readonly ignoredLines: ReadonlySet<number>;
  readonly ignoredRings: ReadonlySet<number>;
  /** True when the lead goes inside its own contour. */
  readonly inside: boolean;
  readonly clearanceMm: number;
  readonly bed: JobBounds | null;
  /** True when the contour, and so its arc leads, go out as G2/G3 moves; else
   * every lead goes out as the chords it is checked by. */
  readonly arcsEmitted: boolean;
  /** Whether ring `index` holds the lead's own contour. */
  readonly ringHoldsContour: (index: number) => boolean;
};

export type LeadFit = { readonly path: LeadPath; readonly shortened: boolean };

const LENGTH_LADDER = [1, 0.75, 0.5, 0.25];
// Walking samples: no more than this apart, so a crossing between two samples
// would put one of them within TOLERANCE_MM of the line it crosses.
const SAMPLE_MM = 0.05;
// Just above the machine curve tolerance: closer than this to its own contour
// a lead may simply be riding the contour's chords near the join.
const TOLERANCE_MM = 0.03;
const BED_SLACK_MM = 1e-6;
// Share of a short lead's own reach into the scrap its free end must keep
// from its contour; the rest allows for the contour curving under it.
const FREE_END_REACH_SHARE = 0.9;
// A lead-out leaving within this of the way its lead-in came retraces it
// (retracesLeadIn).
const RETRACE_DEG = 30;
// Two leads join at one point only within this: a lead-out from anywhere else
// is checked against the whole lead-in.
const SHARED_JOIN_MM = 1e-6;
// A lead written as G2/G3 is checked against its own contour along the arcs
// the machine follows, sampled this finely, not along the chords it is drawn
// with, which the arcs bulge past.
const EMITTED_ARC_SAGITTA_MM = 0.001;

export function fitLead(
  kind: LeadKind,
  join: LeadJoin,
  shape: LeadShape,
  context: LeadFitContext,
): LeadFit | null {
  for (const factor of LENGTH_LADDER) {
    const path = leadPath(kind, join, { ...shape, lengthMm: shape.lengthMm * factor });
    if (leadFits(path, kind, join, context)) return { path, shortened: factor < 1 };
  }
  return null;
}

export function leadFits(
  path: LeadPath,
  kind: LeadKind,
  join: LeadJoin,
  context: LeadFitContext,
): boolean {
  const { at } = join;
  if (!onBed(path, context.bed, context.arcsEmitted)) return false;
  if (crossesOwnContour(emittedPoints(path, context.arcsEmitted), at, context.ownBurn))
    return false;
  const outward = kind === 'in' ? [...path.points].reverse() : path.points;
  // An arc written as G2/G3 bulges up to the sampling sag past the chords
  // checked here, so it keeps that much more clearance from other cut lines.
  const reserveMm =
    context.arcsEmitted && path.moves.some((move) => move.kind === 'arc')
      ? ARC_SAMPLE_SAGITTA_MM
      : 0;
  // The free end keeps the clearance from its own contour, or, for a lead too
  // short to reach that far, nearly as far as its own shape takes it.
  const reachMm = (path.freeEnd.x - at.x) * join.scrap.x + (path.freeEnd.y - at.y) * join.scrap.y;
  const freeEndNeedMm = Math.min(context.clearanceMm, FREE_END_REACH_SHARE * reachMm);
  if (!clearOfCutLines(walkSamples(outward), at, context, reserveMm, freeEndNeedMm)) return false;
  return freeEndInScrap(path.freeEnd, at, context);
}

function clearOfCutLines(
  samples: ReadonlyArray<Vec2>,
  start: Vec2,
  context: LeadFitContext,
  reserveMm: number,
  freeEndNeedMm: number,
): boolean {
  const { obstacles, ownLine, ignoredLines, clearanceMm } = context;
  const keepOutMm = clearanceMm + reserveMm;
  let reached = 0;
  let freeEndMm = 0;
  let previous = start;
  for (const sample of samples) {
    const { ownMm } = obstacles.distancesMm(sample, keepOutMm, ownLine, ignoredLines);
    if (ownMm < Math.min(reached, clearanceMm) - TOLERANCE_MM) return false;
    reached = Math.max(reached, ownMm);
    freeEndMm = ownMm;
    // From the very first step: a lead shorter than the clearance, or one that
    // starts beside another cut, must not cross it on its way out.
    if (!obstacles.otherLinesClear(previous, sample, keepOutMm, ownLine, ignoredLines))
      return false;
    previous = sample;
  }
  // The last sample is the free end, where the start or stop mark lands.
  return freeEndMm >= freeEndNeedMm;
}

function freeEndInScrap(freeEnd: Vec2, at: Vec2, context: LeadFitContext): boolean {
  if (pointInPolygon(freeEnd, context.ownRing) !== context.inside) return false;
  const { obstacles, ignoredRings } = context;
  const candidates = new Set([...obstacles.ringsHolding(freeEnd), ...obstacles.ringsHolding(at)]);
  for (const index of candidates) {
    if (ignoredRings.has(index)) continue;
    const ring = obstacles.rings[index];
    if (ring === undefined) continue;
    const holdsEnd = withinBounds(freeEnd, ring.bounds) && pointInPolygon(freeEnd, ring.points);
    if (holdsEnd !== context.ringHoldsContour(index)) return false;
  }
  return true;
}

function walkSamples(points: ReadonlyArray<Vec2>): Vec2[] {
  const samples: Vec2[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE_MM));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return samples;
}

// The lead's extent as written: its points, and on a machine that takes arcs
// the full sweep of each G2/G3, which bulges past the sampled points and is
// measured exactly as job bounds measure it.
function onBed(path: LeadPath, bed: JobBounds | null, arcsEmitted: boolean): boolean {
  if (bed === null) return true;
  const start = path.points[0];
  if (start === undefined) return false;
  const extent = { minX: start.x, minY: start.y, maxX: start.x, maxY: start.y };
  for (const point of path.points) {
    extent.minX = Math.min(extent.minX, point.x);
    extent.minY = Math.min(extent.minY, point.y);
    extent.maxX = Math.max(extent.maxX, point.x);
    extent.maxY = Math.max(extent.maxY, point.y);
  }
  if (arcsEmitted) extendBoundsByEmittedArcMoves(extent, start, path.moves);
  return (
    extent.minX >= bed.minX - BED_SLACK_MM &&
    extent.maxX <= bed.maxX + BED_SLACK_MM &&
    extent.minY >= bed.minY - BED_SLACK_MM &&
    extent.maxY <= bed.maxY + BED_SLACK_MM
  );
}

function withinBounds(point: Vec2, bounds: JobBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/** Whether a lead-out would burn over its contour's lead-in on the same pass.
 * Where both join the contour at one point, judged there: line leads at a
 * right-angle corner leave along the very line they came in on, and a lead-out
 * leaving within RETRACE_DEG of the way the lead-in came overlaps it for more
 * than a kerf width. Arc leads at a corner part at a right angle and meet again
 * only at their free ends, both in the scrap. A lead-out leaving from
 * anywhere else, however near (an overcut's, from where the overcut ends),
 * must keep the clearance from the whole lead-in once it is the clearance from
 * its own start, or the two cross or run side by side. */
export function retracesLeadIn(leadOut: LeadFit, leadIn: LeadFit, clearanceMm: number): boolean {
  const start = leadOut.path.points[0];
  const inPoints = leadIn.path.points;
  const join = inPoints[inPoints.length - 1];
  if (start === undefined || join === undefined) return false;
  if (Math.hypot(start.x - join.x, start.y - join.y) > SHARED_JOIN_MM) {
    // Step by step, the whole step: a lead-out only grazing the lead-in can
    // come closest between two samples. The step across the clearance from
    // its start is measured from where it crosses.
    let previous = start;
    for (const sample of walkSamples([start, ...leadOut.path.points.slice(1)])) {
      const part = partBeyond(previous, sample, start, clearanceMm);
      if (part !== null && stepToPolylineMm(part[0], part[1], inPoints) < clearanceMm) return true;
      previous = sample;
    }
    return false;
  }
  const outward = direction(start, leadOut.path.points[1]);
  const back = direction(join, inPoints[inPoints.length - 2]);
  if (outward === null || back === null) return false;
  return outward.x * back.x + outward.y * back.y > Math.cos((RETRACE_DEG * Math.PI) / 180);
}

/** The part of the step p-q farther than `radiusMm` from `centre`, or null. */
function partBeyond(p: Vec2, q: Vec2, centre: Vec2, radiusMm: number): [Vec2, Vec2] | null {
  const pInside = Math.hypot(p.x - centre.x, p.y - centre.y) <= radiusMm;
  const qInside = Math.hypot(q.x - centre.x, q.y - centre.y) <= radiusMm;
  if (pInside && qInside) return null;
  if (!pInside && !qInside) return [p, q];
  // Where |p + t (q - p) - centre| = radius: the larger root leaving the
  // circle, the smaller entering it.
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const ox = p.x - centre.x;
  const oy = p.y - centre.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - radiusMm * radiusMm;
  const root = Math.sqrt(Math.max(0, b * b - 4 * a * c));
  const t = Math.max(0, Math.min(1, (-b + (pInside ? root : -root)) / (2 * a)));
  const crossing = { x: p.x + dx * t, y: p.y + dy * t };
  return pInside ? [crossing, q] : [p, crossing];
}

/** The least distance from the step p-q to the polyline. */
function stepToPolylineMm(p: Vec2, q: Vec2, points: ReadonlyArray<Vec2>): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    nearest = Math.min(
      nearest,
      segmentsDistanceMm(p, q, points[index - 1] as Vec2, points[index] as Vec2),
    );
  }
  return nearest;
}

// Crossing segments are 0 apart; otherwise the nearest pair has an endpoint.
function segmentsDistanceMm(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const determinant = rx * sy - ry * sx;
  if (determinant !== 0) {
    const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / determinant;
    const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / determinant;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    pointToSegmentMm(p, a, b),
    pointToSegmentMm(q, a, b),
    pointToSegmentMm(a, p, q),
    pointToSegmentMm(b, p, q),
  );
}

function pointToSegmentMm(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  const t =
    span === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / span));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function direction(from: Vec2 | undefined, to: Vec2 | undefined): Vec2 | null {
  if (from === undefined || to === undefined) return null;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length === 0 ? null : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** The lead as the machine runs it: its arcs, finely sampled, when it goes out
 * as G2/G3; else the chords it is written as. */
function emittedPoints(path: LeadPath, arcsEmitted: boolean): ReadonlyArray<Vec2> {
  const start = path.points[0];
  return arcsEmitted && start !== undefined && path.moves.some((move) => move.kind === 'arc')
    ? sampleArcMoves(start, path.moves, EMITTED_ARC_SAGITTA_MM)
    : path.points;
}
