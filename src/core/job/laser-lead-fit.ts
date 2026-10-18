// Whether a laser lead fits where it is asked to go (ADR-626), and the
// longest lead on the shortening ladder that does. A lead fits when:
//   - it stays on the bed (when the program's bed position is known);
//   - it leaves its own contour and never comes back toward it: walking out
//     from the join, it never comes nearer the contour than it already was
//     (within TOLERANCE_MM, and up to the clearance), and its free end, where
//     the start or stop mark lands, is on the scrap side and at least the
//     clearance away;
//   - away from the join it keeps the clearance from every other cut line,
//     except copies of its own contour (the same outline on another
//     operation);
//   - its free end is inside exactly the closed contours that hold its own
//     contour, so it cannot end inside another part or past the hole or
//     sheet opening its contour sits in.
// Full length first, then shorter steps down to a quarter; null when none fit.

import { pointInPolygon } from '../geometry';
import type { Vec2 } from '../scene';
import type { JobBounds } from './job-bounds';
import type { LeadObstacles } from './laser-lead-obstacles';
import {
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

export function fitLead(
  kind: LeadKind,
  join: LeadJoin,
  shape: LeadShape,
  context: LeadFitContext,
): LeadFit | null {
  for (const factor of LENGTH_LADDER) {
    const path = leadPath(kind, join, { ...shape, lengthMm: shape.lengthMm * factor });
    if (leadFits(path, kind, join.at, context)) return { path, shortened: factor < 1 };
  }
  return null;
}

export function leadFits(
  path: LeadPath,
  kind: LeadKind,
  at: Vec2,
  context: LeadFitContext,
): boolean {
  if (!onBed(path.points, context.bed)) return false;
  const outward = kind === 'in' ? [...path.points].reverse() : path.points;
  if (!clearOfCutLines(walkSamples(outward), at, context)) return false;
  return freeEndInScrap(path.freeEnd, at, context);
}

function clearOfCutLines(samples: ReadonlyArray<Vec2>, at: Vec2, context: LeadFitContext): boolean {
  const { obstacles, ownLine, ignoredLines, clearanceMm } = context;
  let reached = 0;
  let freeEndMm = 0;
  for (const sample of samples) {
    const { ownMm, otherMm } = obstacles.distancesMm(sample, clearanceMm, ownLine, ignoredLines);
    if (ownMm < Math.min(reached, clearanceMm) - TOLERANCE_MM) return false;
    reached = Math.max(reached, ownMm);
    freeEndMm = ownMm;
    const fromJoin = Math.hypot(sample.x - at.x, sample.y - at.y);
    if (fromJoin >= clearanceMm && otherMm < clearanceMm) return false;
  }
  // The last sample is the free end, where the start or stop mark lands.
  return freeEndMm >= clearanceMm;
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

function onBed(points: ReadonlyArray<Vec2>, bed: JobBounds | null): boolean {
  if (bed === null) return true;
  return points.every(
    (point) =>
      point.x >= bed.minX - BED_SLACK_MM &&
      point.x <= bed.maxX + BED_SLACK_MM &&
      point.y >= bed.minY - BED_SLACK_MM &&
      point.y <= bed.maxY + BED_SLACK_MM,
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
