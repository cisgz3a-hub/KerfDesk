// Delete Duplicates (LightBurn gap LBG-F08, ADR-480): find artwork drawn more
// than once at the same place for the same operation. Geometry is compared in
// world space to 0.001 mm, so a copy that was moved back onto its original, or
// is a separate object with the same transform baked in, still counts. Unlike
// LightBurn, a closed shape that starts at a different point or runs the other
// way is the same shape, which is how double outlines arrive from DXF files.
// Copies on different operations are deliberate (score and cut) and are kept,
// as are copies whose tabs placed by hand (CNC or laser) differ.

import {
  isClosedEnough,
  operationIdsForObject,
  type Layer,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../scene';
import { isVectorPathObject, materializeVectorObject } from './vector-path-tools';

const GRID_PER_MM = 1000;

/**
 * Ids to delete: every later copy in a set of duplicates. Protected objects
 * (locked, or used as an image mask or text guide) are never deleted and are
 * kept in preference to an unprotected copy.
 */
export function duplicateObjectIds(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
  protectedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  const sets = new Map<string, SceneObject[]>();
  for (const object of objects) {
    const signature = duplicateSignature(object, layers);
    if (signature === null) continue;
    const set = sets.get(signature);
    if (set === undefined) sets.set(signature, [object]);
    else set.push(object);
  }
  return [...sets.values()].flatMap((set) => {
    if (set.length < 2) return [];
    const keeper = set.find((object) => protectedIds.has(object.id)) ?? set[0];
    return set
      .filter((object) => object !== keeper && !protectedIds.has(object.id))
      .map((object) => object.id);
  });
}

/** What makes two objects the same artwork, or null for objects without paths. */
export function duplicateSignature(
  object: SceneObject,
  layers: ReadonlyArray<Layer>,
): string | null {
  if (!isVectorPathObject(object)) return null;
  const cncAnchors = placedAnchors(object, object.cncTabAnchors);
  const laserAnchors = placedAnchors(object, object.laserTabAnchors);
  const anchored = cncAnchors !== null || laserAnchors !== null;
  const binding = JSON.stringify([
    [...operationIdsForObject(object, layers)].sort(),
    object.powerScale ?? null,
    object.operationOverride ?? null,
    cncAnchors,
    laserAnchors,
    // A tab fraction is measured in local space before the transform. Equal
    // world outlines need not put that fraction at the same physical point
    // when one copy has a different non-uniform scale. Keep its authored basis.
    anchored ? object.transform : null,
  ]);
  // Anchors use path/polyline indexes and a fraction from the authored start.
  // Rotating, reversing or sorting that geometry would move an identical t.
  const paths = materializeVectorObject(object).paths.map((path) =>
    [
      path.color,
      JSON.stringify(path.operationIds ?? null),
      path.fillRule ?? 'evenodd',
      JSON.stringify([path.strokeWidthMm ?? null, path.strokeTransform ?? null]),
      ...orderedKeys(
        path.polylines
          .filter((polyline) => anchored || polyline.points.length > 0)
          .map((polyline) => contourKey(polyline, anchored, path.fillRule === 'nonzero')),
        anchored,
      ),
    ].join('|'),
  );
  return paths.length === 0 ? null : `${binding}#${paths.join('#')}`;
}

// Tabs placed by hand, CNC and laser (ADR-494 Amendment 1), are part of what a
// copy cuts, so copies whose placed tabs differ are not duplicates. An empty
// list places no tab, and neither does an anchor whose path has since changed
// colour, so both sign as no anchors at all. Anchors held on an open contour
// still count, since closing it again puts those tabs back.
function placedAnchors<T extends { readonly layerColor: string; readonly pathIndex: number }>(
  object: SceneObject,
  anchors: ReadonlyArray<T> | undefined,
): ReadonlyArray<T> | null {
  if (anchors === undefined || !('paths' in object)) return null;
  const placed = anchors.filter(
    (anchor) => object.paths[anchor.pathIndex]?.color === anchor.layerColor,
  );
  return placed.length === 0 ? null : placed;
}

function orderedKeys(keys: string[], anchored: boolean): string[] {
  return anchored ? keys : keys.sort();
}

function contourKey(polyline: Polyline, anchored: boolean, preserveWinding: boolean): string {
  const points = polyline.points.map(snap);
  if (anchored) return `${polyline.closed ? 'C' : 'O'}${encode(points)}`;
  if (!isClosedEnough(polyline)) {
    return `O${smaller(encode(points), encode([...points].reverse()))}`;
  }
  const ring = dropRepeatedStart(points);
  const start = lowestIndex(ring);
  const forward = [...ring.slice(start), ...ring.slice(0, start)];
  // A nonzero compound's hole depends on each contour's relative winding.
  if (preserveWinding) return `C${encode(forward)}`;
  const backward = [forward[0] as Vec2, ...forward.slice(1).reverse()];
  return `C${smaller(encode(forward), encode(backward))}`;
}

function snap(point: Vec2): Vec2 {
  return {
    x: Math.round(point.x * GRID_PER_MM) / GRID_PER_MM,
    y: Math.round(point.y * GRID_PER_MM) / GRID_PER_MM,
  };
}

function dropRepeatedStart(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points.at(-1);
  return points.length > 1 && first !== undefined && last !== undefined && samePoint(first, last)
    ? points.slice(0, -1)
    : points;
}

function lowestIndex(points: ReadonlyArray<Vec2>): number {
  let best = 0;
  points.forEach((point, index) => {
    const current = points[best] as Vec2;
    if (point.x < current.x || (point.x === current.x && point.y < current.y)) best = index;
  });
  return best;
}

function encode(points: ReadonlyArray<Vec2>): string {
  return points.map((point) => `${point.x},${point.y}`).join(';');
}

function smaller(a: string, b: string): string {
  return a <= b ? a : b;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
