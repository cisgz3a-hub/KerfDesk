// Whether a laser lead fits where it is asked to go (ADR-626), and the
// longest lead on the shortening ladder that does. A lead fits when:
//   - it stays on the bed (when the program's bed position is known);
//   - it leaves its own contour and never comes back toward it: walking out
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
import type { Vec2 } from '../scene';
import { extendBoundsByEmittedArcMoves } from './cut-arc-moves';
import type { JobBounds } from './job-bounds';
import type { LeadObstacles } from './laser-lead-obstacles';
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

/** Whether a lead-out runs back along its contour's lead-in, so one pass would
 * burn that stretch twice: line leads at a right-angle corner leave along the
 * very line they came in on. Judged where they meet: a lead-out leaving within
 * RETRACE_DEG of the way the lead-in came overlaps it for more than a kerf
 * width. Arc leads at a corner part at a right angle and meet again only at
 * their free ends, both in the scrap. */
export function retracesLeadIn(leadOut: LeadFit, leadIn: LeadFit): boolean {
  const outward = direction(leadOut.path.points[0], leadOut.path.points[1]);
  const inPoints = leadIn.path.points;
  const back = direction(inPoints[inPoints.length - 1], inPoints[inPoints.length - 2]);
  if (outward === null || back === null) return false;
  return outward.x * back.x + outward.y * back.y > Math.cos((RETRACE_DEG * Math.PI) / 180);
}

function direction(from: Vec2 | undefined, to: Vec2 | undefined): Vec2 | null {
  if (from === undefined || to === undefined) return null;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length === 0 ? null : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}
