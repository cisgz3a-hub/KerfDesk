// group-operand-region — the one region a group contributes to Weld, Union
// silhouette and the Boolean tools (ADR-377). LightBurn treats a group as a
// single shape, so an outer circle grouped with an inner circle is a donut, not
// two discs (https://docs.lightburnsoftware.com/2.1/Reference/BooleanTools/).
//
// The rule is by nesting, not raw even-odd parity: a member lying inside
// another member is a hole in that member, a member inside that hole is solid
// again, and members that merely overlap merge. Even-odd would also punch a
// hole wherever two grouped letters overlap, which is exactly what Weld exists
// to remove. Each member region is already normalized (see
// normalizeVectorObjectRegion), so its own holes are kept as they are.

import {
  areaPathsD,
  differenceD,
  FillRule,
  getBoundsPathsD,
  type PathsD,
  type RectD,
} from 'clipper2-ts';
import { ok, type Result } from '../result';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import {
  normalizeVectorObjectRegion,
  unionNormalizedRegions,
  VECTOR_PATH_PRECISION_DECIMALS,
} from './vector-path-regions';
import { tryVectorOp, type VectorOpError, type VectorSceneObject } from './vector-path-tools';

// A member counts as inside another when at most this share of its area (or
// MIN_OUTSIDE_AREA_MM2, whichever is larger) falls outside it. Tessellated
// circles that touch internally poke out by a sliver of chord sagitta; without
// the slack a tangent inner circle would stop being a hole.
const OUTSIDE_AREA_SHARE = 1e-3;
const MIN_OUTSIDE_AREA_MM2 = 1e-4;
const BOUNDS_SLACK_MM = 1e-3;

type Member = {
  readonly paths: PathsD;
  readonly area: number;
  readonly bounds: RectD;
};

/** The region of each operand, where an operand is a lone object or the
 * selected members of one group (see selectionUnits). */
export function operandRegions(
  operands: ReadonlyArray<ReadonlyArray<VectorSceneObject>>,
): Result<ReadonlyArray<PathsD>, VectorOpError> {
  const regions: PathsD[] = [];
  for (const operand of operands) {
    const members: PathsD[] = [];
    for (const object of operand) {
      const region = normalizeVectorObjectRegion(object);
      if (region.kind === 'error') return region;
      members.push(region.value);
    }
    const region = groupOperandRegion(members);
    if (region.kind === 'error') return region;
    regions.push(region.value);
  }
  return ok(regions);
}

/** Combine the normalized regions of one group's members into its region. */
export function groupOperandRegion(members: ReadonlyArray<PathsD>): Result<PathsD, VectorOpError> {
  const populated = members.filter((region) => region.length > 0);
  if (populated.length <= 1) return ok(populated[0] ?? []);
  const measured = tryVectorOp(() => populated.map(measure));
  if (measured.kind === 'error') return measured;
  const parents = tryVectorOp(() => parentIndexes(measured.value));
  if (parents.kind === 'error') return parents;
  return solidRegion(measured.value, parents.value);
}

function measure(paths: PathsD): Member {
  return { paths, area: Math.abs(areaPathsD(paths)), bounds: getBoundsPathsD(paths) };
}

// Each member's parent is the smallest member that strictly contains it.
// Strict containment shrinks area along every chain, so the chains cannot loop.
function parentIndexes(members: ReadonlyArray<Member>): ReadonlyArray<number | null> {
  return members.map((inner, innerIndex) => {
    let parent: Member | null = null;
    let parentIndex: number | null = null;
    for (const [outerIndex, outer] of members.entries()) {
      if (outerIndex === innerIndex || !strictlyContains(outer, inner)) continue;
      if (parent !== null && outer.area >= parent.area) continue;
      parent = outer;
      parentIndex = outerIndex;
    }
    return parentIndex;
  });
}

function strictlyContains(outer: Member, inner: Member): boolean {
  const slack = Math.max(MIN_OUTSIDE_AREA_MM2, OUTSIDE_AREA_SHARE * inner.area);
  // Equal regions (stacked copies) do not nest: they merge like overlaps.
  if (outer.area - inner.area <= slack) return false;
  if (!boundsContain(outer.bounds, inner.bounds)) return false;
  const outside = differenceD(
    inner.paths,
    outer.paths,
    FillRule.NonZero,
    VECTOR_PATH_PRECISION_DECIMALS,
  );
  return Math.abs(areaPathsD(outside)) <= slack;
}

function boundsContain(outer: RectD, inner: RectD): boolean {
  return (
    inner.left >= outer.left - BOUNDS_SLACK_MM &&
    inner.top >= outer.top - BOUNDS_SLACK_MM &&
    inner.right <= outer.right + BOUNDS_SLACK_MM &&
    inner.bottom <= outer.bottom + BOUNDS_SLACK_MM
  );
}

// Members at an even nesting depth are solid, minus the members directly inside
// them; members at an odd depth are those holes. The union of every solid piece
// is the group's region.
function solidRegion(
  members: ReadonlyArray<Member>,
  parents: ReadonlyArray<number | null>,
): Result<PathsD, VectorOpError> {
  const depths = nestingDepths(parents);
  const solids: PathsD[] = [];
  for (const [index, member] of members.entries()) {
    if ((depths[index] ?? 0) % 2 === 1) continue;
    const holes = members.flatMap((candidate, candidateIndex) =>
      parents[candidateIndex] === index ? candidate.paths : [],
    );
    if (holes.length === 0) {
      solids.push(member.paths);
      continue;
    }
    const solid = tryVectorOp(() =>
      canonicalizeVectorPaths(
        differenceD(member.paths, holes, FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS),
      ),
    );
    if (solid.kind === 'error') return solid;
    solids.push(solid.value);
  }
  return unionNormalizedRegions(solids);
}

function nestingDepths(parents: ReadonlyArray<number | null>): ReadonlyArray<number> {
  return parents.map((_, index) => {
    let depth = 0;
    let parent = parents[index] ?? null;
    // A chain is at most as long as the member list (see parentIndexes).
    while (parent !== null && depth < parents.length) {
      depth += 1;
      parent = parents[parent] ?? null;
    }
    return depth;
  });
}
