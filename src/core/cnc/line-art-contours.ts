// selectLineArtContours — which edge of a traced double-line ring is machined
// (ADR-218).
//
// A boundary trace (the Line Art preset) emits a stroked drawing as rings:
// every drawn line becomes an outer edge plus an inner edge one stroke-width
// apart, wound in opposite directions. Machining both edges re-cuts a groove
// the first pass already destroyed — observed in the field as "the job
// finished, then started again in reverse slightly outside the finished path".
//
// A nested closed pair whose bounding boxes sit closer than the bit diameter
// on every side cannot keep material between the two cuts, so it is treated
// as one drawn line and only the selected edge survives. Deliberately
// conservative: anything wider (washer walls, real ring parts), anything
// unpaired (lone contours, open paths), and crossing geometry always cut, so
// 'both' — and every scene without tight double-lines — is byte-identical to
// the pre-option pipeline.

import { pointInPolygon } from '../geometry';
import type { CncCutType, CncLayerSettings, Polyline } from '../scene';

export type LineArtContourSide = NonNullable<CncLayerSettings['lineArtContours']>;

// The compile-time fallback for layers saved before the field existed.
// machine.ts repeats the literal in DEFAULT_CNC_LAYER_SETTINGS because
// core/scene cannot import core/cnc without a cycle.
export const DEFAULT_LINE_ART_CONTOURS: LineArtContourSide = 'inner';

const MIN_CLOSED_POINTS = 3;
// Bbox gaps this far negative mean crossing outlines, not a traced ring.
const GAP_EPSILON_MM = 1e-6;

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

// Band-based cut types (pocket, v-carve, inlay, drill, relief) need both
// edges of a ring to define their geometry; only edge-following cuts choose.
export function lineArtSelectionApplies(cutType: CncCutType): boolean {
  return (
    cutType === 'profile-outside' ||
    cutType === 'profile-inside' ||
    cutType === 'profile-on-path' ||
    cutType === 'engrave'
  );
}

export function selectLineArtContours(
  polylines: ReadonlyArray<Polyline>,
  side: LineArtContourSide,
  toolDiameterMm: number,
): ReadonlyArray<Polyline> {
  if (side === 'both' || !(toolDiameterMm > 0)) return polylines;
  const rings = polylines.filter(isClosedRing);
  if (rings.length < 2) return polylines;
  const bounds = new Map<Polyline, Bounds>(rings.map((ring) => [ring, ringBounds(ring)]));
  const dropped = new Set<Polyline>();
  for (const ring of rings) {
    const parent = directParent(ring, rings, bounds);
    if (parent === null) continue;
    if (!isTightPair(bounds.get(parent) as Bounds, bounds.get(ring) as Bounds, toolDiameterMm)) {
      continue;
    }
    dropped.add(side === 'inner' ? parent : ring);
  }
  if (dropped.size === 0) return polylines;
  return polylines.filter((polyline) => !dropped.has(polyline));
}

function isClosedRing(polyline: Polyline): boolean {
  return polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS;
}

// The smallest ring that contains this ring's probe point — bbox area breaks
// ties toward the immediate enclosure, which is the ring's pair candidate.
function directParent(
  ring: Polyline,
  rings: ReadonlyArray<Polyline>,
  bounds: ReadonlyMap<Polyline, Bounds>,
): Polyline | null {
  const probe = ring.points[0];
  if (probe === undefined) return null;
  let parent: Polyline | null = null;
  let parentArea = Number.POSITIVE_INFINITY;
  for (const candidate of rings) {
    if (candidate === ring) continue;
    if (!pointInPolygon(probe, candidate.points)) continue;
    const area = boundsArea(bounds.get(candidate) as Bounds);
    if (area < parentArea) {
      parent = candidate;
      parentArea = area;
    }
  }
  return parent;
}

// A traced double-line hugs its partner on every side; a washer wall or any
// legitimately nested shape leaves at least one gap wider than the bit.
function isTightPair(parent: Bounds, child: Bounds, toolDiameterMm: number): boolean {
  const gaps = [
    child.minX - parent.minX,
    parent.maxX - child.maxX,
    child.minY - parent.minY,
    parent.maxY - child.maxY,
  ];
  return gaps.every((gap) => gap >= -GAP_EPSILON_MM && gap <= toolDiameterMm);
}

function ringBounds(polyline: Polyline): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polyline.points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

function boundsArea(bounds: Bounds): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}
