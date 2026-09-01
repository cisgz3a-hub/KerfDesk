import type { PathD, PathsD } from 'clipper2-ts';

type CanonicalRing = {
  readonly path: PathD;
};

/**
 * Clipper preserves topology but does not promise raw contour order, starting
 * vertex, or operand-order-stable direction. Canonical output keeps stored
 * source order and source-order compilation deterministic without changing the
 * represented filled region.
 */
export function canonicalizeVectorPaths(paths: PathsD): PathsD {
  // The engine already emits the topology-significant outer/hole direction.
  // Do not infer containment from an arbitrary first vertex: a touching ring
  // can begin on its parent boundary, and reversing it would corrupt the next
  // NonZero reduction. Only the cyclic start and flat order are canonicalized.
  const rings: CanonicalRing[] = paths
    .filter((path) => path.length >= 3)
    .map((path) => ({ path: rotateToCanonicalStart(path) }));
  rings.sort(compareRings);
  return rings.map((ring) => ring.path);
}

/** Stable ordering for already-canonical regions before a commutative n-ary
 * reduction. Clipper rounds every intermediate result to the configured grid,
 * so a canonical operand order is also required for operand-order-stable raw
 * and compiled output. */
export function compareCanonicalVectorPaths(left: PathsD, right: PathsD): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPath = left[index];
    const rightPath = right[index];
    if (leftPath === undefined || rightPath === undefined) break;
    const comparison = comparePaths(leftPath, rightPath);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function rotateToCanonicalStart(path: PathD): PathD {
  if (path.length <= 1) return clonePath(path);
  let bestIndex = 0;
  for (let candidateIndex = 1; candidateIndex < path.length; candidateIndex += 1) {
    if (compareRotations(path, candidateIndex, bestIndex) < 0) bestIndex = candidateIndex;
  }
  const rotated: PathD = [];
  for (let offset = 0; offset < path.length; offset += 1) {
    const point = path[(bestIndex + offset) % path.length];
    if (point === undefined) return clonePath(path);
    rotated.push(clonePoint(point));
  }
  return rotated;
}

function compareRotations(path: PathD, leftStart: number, rightStart: number): number {
  for (let offset = 0; offset < path.length; offset += 1) {
    const left = path[(leftStart + offset) % path.length];
    const right = path[(rightStart + offset) % path.length];
    if (left === undefined || right === undefined) return 0;
    const comparison = comparePoint(left, right);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function compareRings(left: CanonicalRing, right: CanonicalRing): number {
  return comparePaths(left.path, right.path);
}

function comparePaths(left: PathD, right: PathD): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = left[index];
    const rightPoint = right[index];
    if (leftPoint === undefined || rightPoint === undefined) break;
    const comparison = comparePoint(leftPoint, rightPoint);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function comparePoint(left: PathD[number], right: PathD[number]): number {
  if (left.x !== right.x) return left.x - right.x;
  if (left.y !== right.y) return left.y - right.y;
  return (left.z ?? 0) - (right.z ?? 0);
}

function clonePath(path: PathD): PathD {
  return path.map(clonePoint);
}

function clonePoint(point: PathD[number]): PathD[number] {
  return point.z === undefined ? { x: point.x, y: point.y } : { ...point };
}
