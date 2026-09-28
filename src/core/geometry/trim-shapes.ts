// Trim Shapes (LightBurn gap LBG-T04): the stretch of outline under the
// pointer, bounded by the nearest crossings with any other visible vector
// outline (locked ones included, as cutting edges only) or with itself. A contour that crosses nothing is the stretch
// whole. The hovered stretch is what the canvas highlights and what a click
// deletes; trim-shape-edit.ts turns it into the object's new paths.

import type { Scene, Vec2 } from '../scene';
import {
  boundsOverlap,
  createTrimModel,
  type TrimContour,
  type TrimModel,
  type TrimObjectEntry,
} from './trim-contours';
import { contourCrossings, type TrimCrossing } from './trim-crossings';

export type TrimTarget = {
  readonly contour: TrimContour;
  /** Where the deleted stretch starts; null at an open contour's start. */
  readonly start: TrimCrossing | null;
  /** Where it ends; null at an open contour's end. */
  readonly end: TrimCrossing | null;
  /** The whole contour goes: it crosses nothing (a closed one: fewer than two crossings). */
  readonly whole: boolean;
  /** World polyline of the stretch, for the canvas highlight. */
  readonly highlight: ReadonlyArray<Vec2>;
};

/** A scene's outlines and, once asked for, each contour's crossings; reusable while the scene is unchanged. */
export type TrimSession = {
  readonly model: TrimModel;
  readonly crossingsOf: (contour: TrimContour) => ReadonlyArray<TrimCrossing>;
};

type Hover = { readonly contour: TrimContour; readonly p: number };

export function createTrimSession(scene: Scene): TrimSession {
  const model = createTrimModel(scene);
  const cache = new Map<string, ReadonlyArray<TrimCrossing>>();
  return {
    model,
    crossingsOf: (contour) => {
      const cached = cache.get(contour.key);
      if (cached !== undefined) return cached;
      const crossings = contourCrossings(contour, outlinesNear(model, contour));
      cache.set(contour.key, crossings);
      return crossings;
    },
  };
}

/** The stretch a click at `point` would delete, or null when no trimmable outline is that close. */
export function findTrimTarget(
  scene: Scene,
  point: Vec2,
  toleranceMm: number,
  session: TrimSession = createTrimSession(scene),
): TrimTarget | null {
  const hover = nearestContour(session.model, point, toleranceMm);
  if (hover === null) return null;
  return targetAt(hover.contour, session.crossingsOf(hover.contour), hover.p);
}

function nearestContour(model: TrimModel, point: Vec2, tolerance: number): Hover | null {
  const probe = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  let best: (Hover & { readonly distance: number }) | null = null;
  for (const entry of model.entries) {
    if (!boundsOverlap(entry.bounds, probe, tolerance)) continue;
    for (const contour of model.contoursOf(entry)) {
      if (!contour.trimmable || !boundsOverlap(contour.bounds, probe, tolerance)) continue;
      const hit = nearestOnContour(contour, point);
      if (hit.distance > tolerance) continue;
      // Strictly closer only, so the top-most artwork wins a tie.
      if (best === null || hit.distance < best.distance - 1e-9) best = { contour, ...hit };
    }
  }
  return best === null ? null : { contour: best.contour, p: best.p };
}

function nearestOnContour(
  contour: TrimContour,
  point: Vec2,
): { readonly p: number; readonly distance: number } {
  let best = { p: 0, distance: Infinity };
  for (let chord = 0; chord < contour.points.length - 1; chord += 1) {
    const a = contour.points[chord] as Vec2;
    const b = contour.points[chord + 1] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const raw =
      lengthSquared === 0 ? 0 : ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
    const u = Math.min(1, Math.max(0, raw));
    const distance = Math.hypot(a.x + dx * u - point.x, a.y + dy * u - point.y);
    if (distance < best.distance) {
      const p0 = contour.params[chord] as number;
      const p1 = contour.params[chord + 1] as number;
      best = { p: p0 + (p1 - p0) * u, distance };
    }
  }
  return best;
}

/** Every outline that can cut the contour: those whose bounds reach it, itself included. */
function outlinesNear(model: TrimModel, contour: TrimContour): ReadonlyArray<TrimContour> {
  const near = (entry: TrimObjectEntry): boolean => boundsOverlap(entry.bounds, contour.bounds);
  return model.entries.filter(near).flatMap((entry) => model.contoursOf(entry));
}

/** The stretch of `contour` holding position `p`, between its neighbouring crossings. */
export function targetAt(
  contour: TrimContour,
  crossings: ReadonlyArray<TrimCrossing>,
  p: number,
): TrimTarget {
  if (contour.closed ? crossings.length < 2 : crossings.length === 0) {
    return { contour, start: null, end: null, whole: true, highlight: contour.points };
  }
  const { start, end } = boundingCrossings(contour.closed, crossings, p);
  return { contour, start, end, whole: false, highlight: stretchHighlight(contour, start, end) };
}

// The crossings either side of p; on a closed contour they wrap round its start.
function boundingCrossings(
  closed: boolean,
  crossings: ReadonlyArray<TrimCrossing>,
  p: number,
): { readonly start: TrimCrossing | null; readonly end: TrimCrossing | null } {
  const before = [...crossings].reverse().find((crossing) => crossing.p <= p) ?? null;
  const after = crossings.find((crossing) => crossing.p > p) ?? null;
  if (!closed) return { start: before, end: after };
  return { start: before ?? crossings.at(-1) ?? null, end: after ?? crossings[0] ?? null };
}

function stretchHighlight(
  contour: TrimContour,
  start: TrimCrossing | null,
  end: TrimCrossing | null,
): ReadonlyArray<Vec2> {
  const first = contour.params[0] as number;
  const last = contour.params[contour.params.length - 1] as number;
  const from = start?.p ?? first;
  const to = end?.p ?? last;
  if (to > from) return stretchPoints(contour, from, to);
  return [...stretchPoints(contour, from, last), ...stretchPoints(contour, first, to).slice(1)];
}

/** World points of the chords between two positions, ends interpolated. */
export function stretchPoints(contour: TrimContour, from: number, to: number): ReadonlyArray<Vec2> {
  const points: Vec2[] = [pointAt(contour, from)];
  for (let index = 0; index < contour.params.length; index += 1) {
    const param = contour.params[index] as number;
    if (param > from && param < to) points.push(contour.points[index] as Vec2);
  }
  points.push(pointAt(contour, to));
  return points;
}

function pointAt(contour: TrimContour, p: number): Vec2 {
  const params = contour.params;
  let low = 0;
  let high = params.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((params[middle] as number) <= p) low = middle;
    else high = middle;
  }
  const a = contour.points[low] as Vec2;
  const b = contour.points[high] as Vec2;
  const p0 = params[low] as number;
  const p1 = params[high] as number;
  const u = p1 > p0 ? Math.min(1, Math.max(0, (p - p0) / (p1 - p0))) : 0;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}
