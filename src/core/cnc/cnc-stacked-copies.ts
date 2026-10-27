// Stacked exact copies on a filled CNC cut (meta audit M7-P2-2, the 2026-09-29
// CNC pass's P2-toolpath-3; ADR-359 Amendment 3).
//
// Duplicate without moving, a second import of the same file, or an SVG that
// draws one path twice leaves two identical closed outlines on one operation.
// The cut types below fill closed outlines even-odd (kerf-offset.ts and the
// pocket, V-carve and inlay region builders), so a pair of identical outlines
// encloses nothing: the shape is not cut at all, and nothing says so.
// Measured against the compiler: two copies of a closed square emit no motion
// on profile outside, profile inside, pocket, V-carve or inlay pair, while one
// copy is cut. On path, engrave and drill follow the outline itself and cut
// the copy a second time. A stacked copy there can be a deliberate spring
// pass, so those operations keep every copy.
//
// Contours count as copies when they trace the same closed ring at the
// emitter's 0.001 mm resolution, from any start point and in either
// direction, so they would emit the same G-code. Near copies are not merged.
// The rule follows Delete Duplicates (duplicate-shapes.ts, ADR-480), which
// keeps winding for nonzero paths: a converted font fills nonzero (ADR-286),
// so two nonzero contours merge only when they also run the same way.

import type { CncStackedCopyMerge } from '../job/cnc-compilation-sidecar-types';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncCutType,
  type Layer,
  type Polyline,
  type Vec2,
} from '../scene';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';
import { CNC_COORDINATE_QUANTUM_MM } from './cnc-output-precision';

const CUT_TYPES_FILLING_CLOSED_OUTLINES: ReadonlySet<CncCutType> = new Set<CncCutType>([
  'profile-outside',
  'profile-inside',
  'pocket',
  'v-carve',
  'inlay-pair',
]);

/** True when two identical closed outlines would cancel on this cut type. */
export function cutTypeFillsClosedOutlines(cutType: CncCutType): boolean {
  return CUT_TYPES_FILLING_CLOSED_OUTLINES.has(cutType);
}

type Point = readonly [number, number];
type Ring = ReadonlyArray<Point>;
type KeptOutline = { readonly ring: Ring; readonly nonzero: boolean; readonly index: number };

/**
 * Keeps the first of each set of exact closed copies on a filled cut. The kept
 * contour counts the copies it absorbed (`stackedCopies`) and takes over their
 * manual tabs, since every copy traces the same ring.
 */
export function mergeStackedClosedContours(
  layer: Layer,
  contours: ReadonlyArray<CollectedCncContour>,
): CollectedCncContour[] {
  if (!cutTypeFillsClosedOutlines(layerCutType(layer))) return [...contours];
  const kept = new Map<string, KeptOutline[]>();
  const merged: CollectedCncContour[] = [];
  for (const contour of contours) {
    const ring = contour.polyline.closed ? quantizedRing(contour.polyline.points) : null;
    if (ring === null) {
      merged.push(contour);
      continue;
    }
    const signature = ringSignature(ring);
    const nonzero = contour.fillRule === 'nonzero';
    const bucket = kept.get(signature) ?? [];
    const original = bucket.find((candidate) =>
      sameRing(candidate.ring, ring, !(nonzero && candidate.nonzero)),
    );
    const target = original === undefined ? undefined : merged[original.index];
    if (original === undefined || target === undefined) {
      bucket.push({ ring, nonzero, index: merged.length });
      kept.set(signature, bucket);
      merged.push(contour);
      continue;
    }
    merged[original.index] = absorbCopy(target, contour);
  }
  return merged;
}

/**
 * Drops exact closed copies, keeping the first, for a model that fills the
 * outlines even-odd where the cut itself follows every copy (ADR-250
 * Amendment 4). Copies match as above, but either way round whatever the fill
 * rule: filled even-odd, any two coincident rings cancel.
 */
export function withoutStackedClosedCopies(polylines: ReadonlyArray<Polyline>): Polyline[] {
  const kept = new Map<string, Ring[]>();
  const out: Polyline[] = [];
  for (const polyline of polylines) {
    const ring = polyline.closed ? quantizedRing(polyline.points) : null;
    if (ring !== null) {
      const signature = ringSignature(ring);
      const bucket = kept.get(signature) ?? [];
      if (bucket.some((candidate) => sameRing(candidate, ring, true))) continue;
      kept.set(signature, [...bucket, ring]);
    }
    out.push(polyline);
  }
  return out;
}

/** The copies each operation merged, read from the contours it actually cut. */
export function cncStackedCopyMerges(
  layer: Layer,
  contours: ReadonlyArray<CollectedCncContour>,
): ReadonlyArray<CncStackedCopyMerge> {
  const count = contours.reduce((sum, contour) => sum + (contour.stackedCopies ?? 0), 0);
  return count === 0 ? [] : [{ layerId: layer.id, cutType: layerCutType(layer), count }];
}

function layerCutType(layer: Layer): CncCutType {
  return (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType;
}

function absorbCopy(target: CollectedCncContour, copy: CollectedCncContour): CollectedCncContour {
  const tabs = [...(target.manualTabPoints ?? [])];
  for (const point of copy.manualTabPoints ?? []) {
    if (!tabs.some((tab) => tab.x === point.x && tab.y === point.y)) tabs.push(point);
  }
  return {
    ...target,
    stackedCopies: (target.stackedCopies ?? 0) + 1 + (copy.stackedCopies ?? 0),
    ...(tabs.length === 0 ? {} : { manualTabPoints: tabs }),
  };
}

// Whole quanta, without repeated vertices or the closing vertex, so a ring
// written with or without its closing point compares equal.
function quantizedRing(points: ReadonlyArray<Vec2>): Ring | null {
  const ring: Point[] = [];
  for (const point of points) {
    const next = [quantize(point.x), quantize(point.y)] as const;
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) return null;
    const last = ring[ring.length - 1];
    if (last === undefined || !samePoint(last, next)) ring.push(next);
  }
  const first = ring[0];
  while (first !== undefined && ring.length > 1 && samePoint(first, pointAt(ring, -1))) {
    ring.pop();
  }
  return ring.length >= 3 ? ring : null;
}

function quantize(value: number): number {
  return Math.round(value / CNC_COORDINATE_QUANTUM_MM);
}

// Rings that could be copies share their vertex count and bounding box, so
// only those are compared vertex by vertex.
function ringSignature(ring: Ring): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return `${ring.length}:${minX}:${minY}:${maxX}:${maxY}`;
}

// The same cyclic sequence of vertices from any start, and in either direction
// when the winding does not matter.
function sameRing(a: Ring, b: Ring, eitherDirection: boolean): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const start = pointAt(a, 0);
  for (let offset = 0; offset < b.length; offset += 1) {
    if (!samePoint(start, pointAt(b, offset))) continue;
    if (matchesFrom(a, b, offset, 1)) return true;
    if (eitherDirection && matchesFrom(a, b, offset, -1)) return true;
  }
  return false;
}

function matchesFrom(a: Ring, b: Ring, offset: number, step: 1 | -1): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (!samePoint(pointAt(a, i), pointAt(b, offset + step * i))) return false;
  }
  return true;
}

// Cyclic index into a non-empty ring.
function pointAt(ring: Ring, index: number): Point {
  const n = ring.length;
  return ring[((index % n) + n) % n] ?? [NaN, NaN];
}

function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
