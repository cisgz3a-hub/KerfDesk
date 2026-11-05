// Which separately drawn shapes of a selection are holes (ADR-410 Amendment 3).
// Offset Shapes and the properties-panel offset used to union every selected
// shape under the non-zero rule, so a shape drawn as its own object inside
// another (a hole drawn with the Rectangle tool inside a plate) was swallowed
// and got no offset. The selection is now read the way the same art drawn as one
// compound path, the kerf offset (ADR-486) and LightBurn read it: contours that
// nest alternate between outline and hole. Shapes that only overlap are still
// unioned, as ADR-410 item 3 decides.
//
// Each batch (one ColoredPath, already normalized under its own fill rule) is
// split into rings. A ring's depth is the longest chain of rings that strictly
// enclose it: its own batch's, from Clipper's tree, and other batches', tested.
// Longest, not a count: a hole drawn inside two overlapping plates is one level
// down, not two. Each piece (an outline with its own holes) is then added at an
// even depth or carved at an odd one as a whole, so a shape lying across another
// shape's hole still fills it as a union does. A piece with another batch's ring
// between its outline and one of its holes is taken ring by ring instead, as the
// kerf offset does, so that hole becomes an island again.

import {
  areaD,
  booleanOpDWithPolyTree,
  ClipType,
  differenceD,
  FillRule,
  PolyTreeD,
  unionD,
  type PathD,
  type PathsD,
  type PolyPathD,
} from 'clipper2-ts';
import { ok, type Result } from '../result';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import { paintNestedUnits, type NestedUnit } from './vector-path-nesting-paint';
import { VECTOR_PATH_PRECISION_DECIMALS } from './vector-path-regions';
import { tryVectorOp, type VectorOpError } from './vector-path-tools';

// What is left of a ring after taking an enclosing ring away is rounding when it
// is thinner than one step of the 1 µm grid both were normalized on: a ring
// drawn along its container's edge, for example, after a rotation.
const GRID_STEP_MM = 10 ** -VECTOR_PATH_PRECISION_DECIMALS;

type RingBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type Ring = {
  readonly path: PathD;
  readonly batch: number;
  /** The ring of the same batch that directly encloses this one. */
  readonly parent: number | null;
  readonly isHole: boolean;
  readonly area: number;
  readonly bounds: RingBounds;
};

/**
 * The region a selection of separately normalized batches encloses when a
 * shape inside another is a hole, or, with `outermostOnly`, the outlines no
 * other shape encloses. Null when no ring lies inside another batch's ring: the
 * plain union of the batches is then that region, and callers keep using it.
 */
export function nestedSelectionRegion(
  batches: ReadonlyArray<PathsD>,
  outermostOnly: boolean,
): Result<PathsD | null, VectorOpError> {
  const populated = batches.filter((paths) => paths.length > 0);
  if (populated.length < 2) return ok(null);
  return tryVectorOp(() => {
    const rings = selectionRings(populated);
    const depths = ringDepths(rings);
    if (depths === null) return null;
    if (outermostOnly) {
      return union(rings.filter((_, index) => depths[index] === 0).map((ring) => ring.path));
    }
    return paintNestedUnits(selectionUnits(rings, depths));
  });
}

function selectionRings(batches: ReadonlyArray<PathsD>): Ring[] {
  const rings: Ring[] = [];
  batches.forEach((paths, batch) => {
    const tree = new PolyTreeD();
    booleanOpDWithPolyTree(
      ClipType.Union,
      [...paths],
      null,
      tree,
      FillRule.NonZero,
      VECTOR_PATH_PRECISION_DECIMALS,
    );
    addRings(tree, null, batch, rings);
  });
  return rings;
}

function addRings(node: PolyPathD, parent: number | null, batch: number, rings: Ring[]): void {
  for (let index = 0; index < node.count; index += 1) {
    const child = node.child(index);
    const path = child.poly ?? [];
    if (path.length < 3) continue;
    const at = rings.length;
    const area = areaD(path);
    // Outlines wind positive and holes negative, whatever Clipper returned.
    const positive = area > 0;
    const oriented = positive === !child.isHole ? path : [...path].reverse();
    rings.push({
      path: oriented,
      batch,
      parent,
      isHole: child.isHole,
      area: Math.abs(area),
      bounds: boundsOf(path),
    });
    addRings(child, at, batch, rings);
  }
}

// Null when no other batch puts any ring deeper than its own batch does. Rings
// are visited largest first, so every ring that can enclose one has its depth
// already.
function ringDepths(rings: ReadonlyArray<Ring>): number[] | null {
  const order = rings
    .map((_, index) => index)
    .sort((a, b) => (rings[b]?.area ?? 0) - (rings[a]?.area ?? 0) || a - b);
  const depths: number[] = rings.map(() => 0);
  const visited: number[][] = [];
  let nested = false;
  for (const index of order) {
    const ring = rings[index];
    if (ring === undefined) continue;
    const own = ring.parent === null ? 0 : (depths[ring.parent] ?? 0) + 1;
    const depth = deepestEncloser(rings, visited, ring, own);
    if (depth > own) nested = true;
    depths[index] = depth;
    (visited[depth] ??= []).push(index);
  }
  return nested ? depths : null;
}

// The depth is the deepest enclosing ring's plus one, so the visited rings (the
// ones at least as large) are tried deepest first and the first that encloses
// settles it (perf audit S6-P3-1). Asking every larger ring cost two clipper
// differences each, which nested rings pay for every pair.
function deepestEncloser(
  rings: ReadonlyArray<Ring>,
  visited: ReadonlyArray<ReadonlyArray<number> | undefined>,
  ring: Ring,
  own: number,
): number {
  for (let level = visited.length - 1; level >= own; level -= 1) {
    for (const index of visited[level] ?? []) {
      const other = rings[index];
      if (other === undefined || other.batch === ring.batch) continue;
      if (boundsEnclose(other.bounds, ring.bounds) && encloses(other.path, ring.path)) {
        return level + 1;
      }
    }
  }
  return own;
}

// Strictly: two copies of one shape do not enclose each other, so they union
// instead of cancelling as they would under the even-odd rule.
function encloses(outer: PathD, inner: PathD): boolean {
  return within(inner, outer) && !within(outer, inner);
}

function within(inner: PathD, outer: PathD): boolean {
  const rest = differenceD([inner], [outer], FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS);
  return rest.every((path) => 2 * Math.abs(areaD(path)) <= GRID_STEP_MM * perimeter(path));
}

// A piece whose holes all sit directly inside its outline is one unit; one with
// another batch's ring in between is a unit per ring, each at its own depth.
function selectionUnits(rings: ReadonlyArray<Ring>, depths: ReadonlyArray<number>): NestedUnit[] {
  const holes = new Map<number, number[]>();
  rings.forEach((ring, index) => {
    if (!ring.isHole || ring.parent === null) return;
    holes.set(ring.parent, [...(holes.get(ring.parent) ?? []), index]);
  });
  const units: NestedUnit[] = [];
  rings.forEach((ring, index) => {
    if (ring.isHole) return;
    const depth = depths[index] ?? 0;
    const own = holes.get(index) ?? [];
    if (own.every((hole) => depths[hole] === depth + 1)) {
      units.push({ depth, paths: [ring.path, ...own.map((hole) => rings[hole]?.path ?? [])] });
      return;
    }
    units.push({ depth, paths: [ring.path] });
    for (const hole of own) {
      const path = rings[hole]?.path ?? [];
      units.push({ depth: depths[hole] ?? 0, paths: [[...path].reverse()] });
    }
  });
  return units;
}

function union(paths: PathsD): PathsD {
  return canonicalizeVectorPaths(
    unionD(paths, [], FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS),
  );
}

function boundsOf(path: PathD): RingBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of path) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function boundsEnclose(outer: RingBounds, inner: RingBounds): boolean {
  const slack = GRID_STEP_MM / 2;
  return (
    outer.minX <= inner.minX + slack &&
    outer.minY <= inner.minY + slack &&
    outer.maxX >= inner.maxX - slack &&
    outer.maxY >= inner.maxY - slack
  );
}

function perimeter(path: PathD): number {
  let length = 0;
  path.forEach((point, index) => {
    const next = path[(index + 1) % path.length];
    if (next !== undefined) length += Math.hypot(next.x - point.x, next.y - point.y);
  });
  return length;
}
