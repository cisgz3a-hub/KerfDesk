// tracking — polar/angle tracking and alignment guides (ADR-272 Amendment 6,
// Phase N DS-4b).
//
// Tracking is weaker than an object snap and stronger than the grid. An object
// snap names a real point on real geometry; a tracking guide only says "this
// lines up with something", so it must never pull the pointer off a corner the
// operator is hovering. The resolver applies these only when no object snap
// captured the pointer.
//
//   polar     - the direction from the gesture's anchor rounds to a multiple of
//               the polar step (AutoCAD polar tracking, Fusion's inference
//               lines). Ortho is the 90-degree special case and stays its own
//               toggle.
//   alignment - the pointer shares an X or Y with a key point of another object
//               (AutoCAD object-snap tracking, the smart guides of Figma and
//               Illustrator). X and Y may align to two different objects at once.
//   on-ray    - a polar ray crossing an alignment line: both at once, which is
//               how "45 degrees until it is level with that corner" is drawn.
//
// Every function returns the DRAWN guide segments alongside the point, so the
// canvas shows exactly the relationship that moved the pointer.

import type { Bounds, Vec2 } from '../../scene';

export type TrackingLine = { readonly fromMm: Vec2; readonly toMm: Vec2 };

export type TrackedPoint = {
  readonly atMm: Vec2;
  readonly guides: ReadonlyArray<TrackingLine>;
  // The polar angle the point was tracked to, when a polar ray caught it.
  readonly polarDeg?: number;
};

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const FULL_TURN_DEG = 360;

/**
 * The pointer pulled onto the nearest polar ray from `fromMm`, or null when it
 * is not within `toleranceMm` of one. Near the anchor every ray is within reach,
 * so a pointer closer than the tolerance tracks nothing.
 */
export function polarTrack(
  fromMm: Vec2,
  pointMm: Vec2,
  stepDeg: number,
  toleranceMm: number,
): TrackedPoint | null {
  if (!(stepDeg > 0) || !(toleranceMm > 0)) return null;
  const dx = pointMm.x - fromMm.x;
  const dy = pointMm.y - fromMm.y;
  const reach = Math.hypot(dx, dy);
  if (reach <= toleranceMm) return null;
  const angleDeg = Math.atan2(dy, dx) * RAD_TO_DEG;
  const snappedDeg = Math.round(angleDeg / stepDeg) * stepDeg;
  const offRad = (angleDeg - snappedDeg) * DEG_TO_RAD;
  if (Math.abs(reach * Math.sin(offRad)) > toleranceMm) return null;
  const along = reach * Math.cos(offRad);
  const ux = Math.cos(snappedDeg * DEG_TO_RAD);
  const uy = Math.sin(snappedDeg * DEG_TO_RAD);
  const atMm = { x: fromMm.x + ux * along, y: fromMm.y + uy * along };
  return {
    atMm,
    guides: [{ fromMm, toMm: atMm }],
    polarDeg: ((snappedDeg % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG,
  };
}

/**
 * The pointer lined up with the nearest reference on each axis independently,
 * or null when neither axis is within `toleranceMm` of any reference.
 */
export function alignToPoints(
  pointMm: Vec2,
  references: ReadonlyArray<Vec2>,
  toleranceMm: number,
): TrackedPoint | null {
  const byX = nearestOnAxis(pointMm, references, 'x', toleranceMm);
  const byY = nearestOnAxis(pointMm, references, 'y', toleranceMm);
  if (byX === null && byY === null) return null;
  const atMm = { x: byX?.x ?? pointMm.x, y: byY?.y ?? pointMm.y };
  const guides: TrackingLine[] = [];
  if (byX !== null) guides.push({ fromMm: byX, toMm: atMm });
  if (byY !== null) guides.push({ fromMm: byY, toMm: atMm });
  return { atMm, guides };
}

/**
 * Where a polar ray crosses an alignment line nearest the pointer: the point
 * that is at the tracked angle AND level with a reference. Null when no such
 * crossing is within `toleranceMm` of the pointer.
 */
export function alignOnRay(
  polar: TrackedPoint & { readonly polarDeg: number },
  fromMm: Vec2,
  pointMm: Vec2,
  references: ReadonlyArray<Vec2>,
  toleranceMm: number,
): TrackedPoint | null {
  const ux = Math.cos(polar.polarDeg * DEG_TO_RAD);
  const uy = Math.sin(polar.polarDeg * DEG_TO_RAD);
  let best: { atMm: Vec2; ref: Vec2; distance: number } | null = null;
  for (const ref of references) {
    for (const crossing of rayCrossings(fromMm, ux, uy, ref)) {
      const distance = Math.hypot(crossing.x - pointMm.x, crossing.y - pointMm.y);
      if (distance > toleranceMm || (best !== null && distance >= best.distance)) continue;
      best = { atMm: crossing, ref, distance };
    }
  }
  if (best === null) return null;
  return {
    atMm: best.atMm,
    guides: [
      { fromMm, toMm: best.atMm },
      { fromMm: best.ref, toMm: best.atMm },
    ],
    polarDeg: polar.polarDeg,
  };
}

// The ray's crossings with the vertical and horizontal lines through `ref`,
// ahead of the anchor only. A ray parallel to one of the lines never crosses it.
function rayCrossings(fromMm: Vec2, ux: number, uy: number, ref: Vec2): Vec2[] {
  const crossings: Vec2[] = [];
  const PARALLEL = 1e-9;
  if (Math.abs(ux) > PARALLEL) {
    const t = (ref.x - fromMm.x) / ux;
    if (t > 0) crossings.push({ x: ref.x, y: fromMm.y + uy * t });
  }
  if (Math.abs(uy) > PARALLEL) {
    const t = (ref.y - fromMm.y) / uy;
    if (t > 0) crossings.push({ x: fromMm.x + ux * t, y: ref.y });
  }
  return crossings;
}

export type BoundsAlignment = {
  readonly deltaMm: Vec2;
  readonly guides: ReadonlyArray<TrackingLine>;
};

/**
 * Smart guides for a selection being dragged: the shift that lines the moving
 * box's left / centre / right (and bottom / middle / top) up with the same
 * features of another object, each axis independently, or null when nothing is
 * within `toleranceMm`. Each guide spans both boxes along the shared line.
 */
export function alignBounds(
  moving: Bounds,
  references: ReadonlyArray<Bounds>,
  toleranceMm: number,
): BoundsAlignment | null {
  const x = nearestFeature(moving, references, 'x', toleranceMm);
  const y = nearestFeature(moving, references, 'y', toleranceMm);
  if (x === null && y === null) return null;
  const deltaMm = { x: x?.shift ?? 0, y: y?.shift ?? 0 };
  const placed = shiftBounds(moving, deltaMm);
  const guides: TrackingLine[] = [];
  if (x !== null) {
    const low = Math.min(placed.minY, x.reference.minY);
    const high = Math.max(placed.maxY, x.reference.maxY);
    guides.push({ fromMm: { x: x.at, y: low }, toMm: { x: x.at, y: high } });
  }
  if (y !== null) {
    const low = Math.min(placed.minX, y.reference.minX);
    const high = Math.max(placed.maxX, y.reference.maxX);
    guides.push({ fromMm: { x: low, y: y.at }, toMm: { x: high, y: y.at } });
  }
  return { deltaMm, guides };
}

type FeatureMatch = { readonly shift: number; readonly at: number; readonly reference: Bounds };

function nearestFeature(
  moving: Bounds,
  references: ReadonlyArray<Bounds>,
  axis: 'x' | 'y',
  toleranceMm: number,
): FeatureMatch | null {
  let best: FeatureMatch | null = null;
  for (const reference of references) {
    for (const own of features(moving, axis)) {
      for (const theirs of features(reference, axis)) {
        const shift = theirs - own;
        if (Math.abs(shift) > toleranceMm) continue;
        if (best !== null && Math.abs(shift) >= Math.abs(best.shift)) continue;
        best = { shift, at: theirs, reference };
      }
    }
  }
  return best;
}

function features(bounds: Bounds, axis: 'x' | 'y'): [number, number, number] {
  return axis === 'x'
    ? [bounds.minX, (bounds.minX + bounds.maxX) / 2, bounds.maxX]
    : [bounds.minY, (bounds.minY + bounds.maxY) / 2, bounds.maxY];
}

function shiftBounds(bounds: Bounds, delta: Vec2): Bounds {
  return {
    minX: bounds.minX + delta.x,
    minY: bounds.minY + delta.y,
    maxX: bounds.maxX + delta.x,
    maxY: bounds.maxY + delta.y,
  };
}

function nearestOnAxis(
  pointMm: Vec2,
  references: ReadonlyArray<Vec2>,
  axis: 'x' | 'y',
  toleranceMm: number,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestGap = toleranceMm;
  for (const ref of references) {
    const gap = Math.abs(ref[axis] - pointMm[axis]);
    // Ties go to the nearer reference, so the drawn guide is the short one.
    if (gap < bestGap || (best !== null && gap === bestGap && closer(ref, best, pointMm))) {
      best = ref;
      bestGap = gap;
    }
  }
  return best;
}

function closer(a: Vec2, b: Vec2, to: Vec2): boolean {
  return Math.hypot(a.x - to.x, a.y - to.y) < Math.hypot(b.x - to.x, b.y - to.y);
}
