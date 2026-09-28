// The containment forest a filled path carries (ADR-531).
//
// The contour tracer knows exactly which closed subpath lies inside which: it
// builds the forest on the pixel lattice before any smoothing. It stores that
// forest on the path as `subpathNesting`, the parent of every subpath, so the
// consumers that used to rebuild nesting with point-in-polygon probes (inside
// first cutting, Break Apart) can read it instead.
//
// A carried forest is only as good as the geometry it was computed for. Any
// writer that rebuilds a path with `{ ...path, curves }` would otherwise carry
// a stale forest along, so the forest is stored with a key of the canonical
// geometry (a hash of every subpath's closure, segment kinds and coordinates)
// and a reader gets it back only while the key still matches. Stages that keep
// nesting by construction (an affine map with nonzero determinant, a
// topology-preserving simplification, taking a subset of subpaths) re-stamp
// it with `carrySubpathNesting` / `subsetSubpathNesting`. Everything else
// falls back to the reader's geometric test, as before the forest existed.
//
// The key is computed from the curves when a path has them, and otherwise from
// the polylines read as straight-segment curves, so saving a project (which
// materializes curves from polylines) keeps the key. JSON round trips doubles
// exactly, so a loaded project keeps its forest.

import type { ColoredPath, CurveSubpath, Polyline, SubpathNesting } from './scene-object';

const NO_PARENT = -1;
const SEGMENT_CODE = { line: 1, cubic: 2, 'elliptical-arc': 3 } as const;

/**
 * The subpath parents a path carries, or null when it carries none or they no
 * longer describe its geometry. Valid parents are integers, each -1 or the
 * index of an earlier closed subpath, one per subpath.
 */
export function carriedSubpathParents(path: ColoredPath): ReadonlyArray<number> | null {
  const nesting = path.subpathNesting;
  if (nesting === undefined || !validNestingShape(nesting)) return null;
  const count = subpathCountOf(path);
  const { parents } = nesting;
  if (parents.length !== count) return null;
  for (let index = 0; index < count; index += 1) {
    const parent = parents[index] as number;
    if (!Number.isInteger(parent) || parent < NO_PARENT || parent >= index) return null;
    if (parent >= 0 && !(subpathClosed(path, parent) && subpathClosed(path, index))) return null;
  }
  return nesting.geometryKey === subpathGeometryKey(path) ? parents : null;
}

/** Depth of every subpath (0 = outer) from the carried forest, or null. */
export function carriedSubpathDepths(path: ColoredPath): ReadonlyArray<number> | null {
  const parents = carriedSubpathParents(path);
  if (parents === null) return null;
  const depths: number[] = [];
  parents.forEach((parent, index) => {
    depths[index] = parent < 0 ? 0 : (depths[parent] as number) + 1;
  });
  return depths;
}

/** `path` carrying `parents` (each -1 or an earlier closed subpath), stamped
 *  with the key of its current geometry. Invalid parents drop the field. */
export function withSubpathNesting(path: ColoredPath, parents: ReadonlyArray<number>): ColoredPath {
  const { subpathNesting: _previous, ...rest } = path;
  const stamped: ColoredPath = {
    ...rest,
    subpathNesting: { parents: [...parents], geometryKey: subpathGeometryKey(rest) },
  };
  return carriedSubpathParents(stamped) === null ? rest : stamped;
}

/**
 * Carry the forest of `before` onto `after`, the same subpaths in the same
 * order after a change that cannot alter containment (an affine map with
 * nonzero determinant, or a simplification checked for topology). Without a
 * valid forest on `before`, `after` is returned without one.
 */
export function carrySubpathNesting(before: ColoredPath, after: ColoredPath): ColoredPath {
  const parents = carriedSubpathParents(before);
  return parents === null ? withoutSubpathNesting(after) : withSubpathNesting(after, parents);
}

/** `path` without a carried forest. */
export function withoutSubpathNesting(path: ColoredPath): ColoredPath {
  if (path.subpathNesting === undefined) return path;
  const { subpathNesting: _stale, ...rest } = path;
  return rest;
}

/**
 * The forest of `path` restricted to the subpaths `indices` (ascending), for a
 * path built from exactly those subpaths in that order: each kept subpath's
 * parent becomes its nearest kept ancestor.
 */
export function subsetSubpathNesting(
  path: ColoredPath,
  indices: ReadonlyArray<number>,
  subset: ColoredPath,
): ColoredPath {
  const parents = carriedSubpathParents(path);
  const ascending = indices.every((value, at) => at === 0 || value > (indices[at - 1] as number));
  if (parents === null || !ascending) return withoutSubpathNesting(subset);
  const position = new Map<number, number>();
  indices.forEach((original, at) => position.set(original, at));
  const restricted = indices.map((original) => {
    let ancestor = parents[original] ?? NO_PARENT;
    while (ancestor >= 0 && !position.has(ancestor)) ancestor = parents[ancestor] ?? NO_PARENT;
    return ancestor < 0 ? NO_PARENT : (position.get(ancestor) as number);
  });
  return withSubpathNesting(subset, restricted);
}

/** Key of a path's canonical subpath geometry (see the file header). */
export function subpathGeometryKey(path: ColoredPath): string {
  const hash = new GeometryHash();
  const count = subpathCountOf(path);
  hash.number(count);
  if (path.curves !== undefined) {
    for (const curve of path.curves) hashCurve(hash, curve);
  } else {
    for (const polyline of path.polylines) hashPolyline(hash, polyline);
  }
  return `${count}:${hash.digest()}`;
}

function hashCurve(hash: GeometryHash, curve: CurveSubpath): void {
  hash.number(curve.closed ? 1 : 0);
  hash.number(curve.start.x);
  hash.number(curve.start.y);
  hash.number(curve.segments.length);
  for (const segment of curve.segments) {
    hash.number(SEGMENT_CODE[segment.kind]);
    if (segment.kind === 'cubic') {
      hash.number(segment.control1.x);
      hash.number(segment.control1.y);
      hash.number(segment.control2.x);
      hash.number(segment.control2.y);
    } else if (segment.kind === 'elliptical-arc') {
      hash.number(segment.radiusX);
      hash.number(segment.radiusY);
      hash.number(segment.rotationDeg);
      hash.number(segment.largeArc ? 1 : 0);
      hash.number(segment.sweep ? 1 : 0);
    }
    hash.number(segment.to.x);
    hash.number(segment.to.y);
  }
}

// The same words `hashCurve` feeds for the straight-segment curve
// `polylineToCurveSubpath` builds from this polyline.
function hashPolyline(hash: GeometryHash, polyline: Polyline): void {
  const [start, ...rest] = polyline.points;
  hash.number(polyline.closed ? 1 : 0);
  hash.number(start?.x ?? 0);
  hash.number(start?.y ?? 0);
  hash.number(rest.length);
  for (const point of rest) {
    hash.number(SEGMENT_CODE.line);
    hash.number(point.x);
    hash.number(point.y);
  }
}

function subpathCountOf(path: ColoredPath): number {
  return path.curves?.length ?? path.polylines.length;
}

function subpathClosed(path: ColoredPath, index: number): boolean {
  return (path.curves === undefined ? path.polylines[index] : path.curves[index])?.closed === true;
}

function validNestingShape(nesting: SubpathNesting): boolean {
  return (
    typeof nesting === 'object' &&
    nesting !== null &&
    Array.isArray(nesting.parents) &&
    typeof nesting.geometryKey === 'string'
  );
}

// Two independent 32-bit FNV-1a style lanes over the IEEE-754 words of every
// number: 64 bits, so an accidental match needs ~2^32 distinct edits.
class GeometryHash {
  private readonly float = new Float64Array(1);
  private readonly words = new Uint32Array(this.float.buffer);
  private a = 0x811c9dc5;
  private b = 0x01000193 ^ 0x5bd1e995;

  number(value: number): void {
    // One representation for zero: -0 and 0 describe the same point.
    this.float[0] = value === 0 ? 0 : value;
    for (const word of this.words) {
      this.a = Math.imul(this.a ^ word, 0x01000193) >>> 0;
      this.b = Math.imul(this.b ^ word, 0x5bd1e995) >>> 0;
      this.b ^= this.b >>> 15;
    }
  }

  digest(): string {
    return `${this.a.toString(16).padStart(8, '0')}${this.b.toString(16).padStart(8, '0')}`;
  }
}
