// Group a filled path's subpaths into outer shapes (ADR-398).
//
// A filled trace stores every boundary of every shape as one list of closed
// subpaths and relies on the fill rule to tell outers from holes. Splitting
// that list one subpath per object turns every hole into a solid disc. This
// module recovers the shapes from containment: loops that do not cross form
// a tree (each loop's parent is its nearest container), and the fill of the
// region just inside a loop is its parent's region plus that one loop. A loop
// whose outside region is unfilled starts a new shape (an outer, or an island
// inside a hole); any other loop is a boundary inside its parent's shape (a
// hole, or under nonzero a same-direction inner edge) and joins it.
//
// Exactness: at any point, the loops around it form one chain in the tree.
// Every loop of the chain that belongs to an enclosing shape adds up to an
// unfilled region at the start of the next shape (count even, or winding 0),
// so within each shape the even-odd parity or nonzero winding equals the
// original's. The shapes therefore partition the original burn area.

import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  type ColoredPath,
  type Vec2,
} from '../scene';
import { nearestContainers, type NestingLoop } from './loop-nesting';
import { signedAreaMm2 } from './polyline-orientation';

type Loop = NestingLoop & {
  readonly index: number;
  // +1 counter-clockwise, -1 clockwise (y-up); only relative signs matter.
  readonly direction: number;
};

export type ShapeFillRule = 'nonzero' | 'evenodd';

// Crossings and winding of the region just inside a loop.
type Coverage = { readonly count: number; readonly winding: number };

const UNFILLED: Coverage = { count: 0, winding: 0 };

const RELATIVE_EPS = 1e-9;
const MIN_LOOP_POINTS = 3;

/** Number of independently selectable subpaths in a path (curves win over the compatibility view). */
export function subpathCount(path: ColoredPath): number {
  return path.curves?.length ?? path.polylines.length;
}

/**
 * Subpath indices of `path` grouped into outer shapes, each outer with its
 * direct holes. Open or degenerate subpaths form their own group. Groups are
 * ordered by their first subpath index and keep original order inside, so the
 * pieces preserve the source drawing order. `fillRule` is the path's resolved
 * rule (an absent `ColoredPath.fillRule` means even-odd outside text).
 */
export function groupSubpathsByOuterShape(
  path: ColoredPath,
  fillRule: ShapeFillRule = path.fillRule ?? 'evenodd',
): ReadonlyArray<ReadonlyArray<number>> {
  const count = subpathCount(path);
  const loops: Loop[] = [];
  const groupOf = new Array<number>(count);
  const groups: number[][] = [];
  for (let index = 0; index < count; index += 1) {
    const loop = closedLoop(path, index);
    if (loop === null) {
      groupOf[index] = groups.push([index]) - 1;
    } else {
      loops.push(loop);
    }
  }
  assignLoopGroups(loops, fillRule, groupOf, groups);
  return groups
    .map((members) => [...members].sort((a, b) => a - b))
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
}

function assignLoopGroups(
  loops: ReadonlyArray<Loop>,
  fillRule: ShapeFillRule,
  groupOf: number[],
  groups: number[][],
): void {
  const parents = nearestContainers(loops);
  // Larger loops first: a container always has a larger area than what it holds.
  const order = loops
    .map((_, position) => position)
    .sort(
      (a, b) =>
        (loops[b] as Loop).area - (loops[a] as Loop).area ||
        (loops[a] as Loop).index - (loops[b] as Loop).index,
    );
  const inside = new Map<number, Coverage>();
  for (const position of order) {
    const loop = loops[position] as Loop;
    const parentAt = parents[position] ?? -1;
    const parent = parentAt < 0 ? null : (loops[parentAt] as Loop);
    const outside = parent === null ? UNFILLED : (inside.get(parent.index) ?? UNFILLED);
    inside.set(loop.index, {
      count: outside.count + 1,
      winding: outside.winding + loop.direction,
    });
    if (parent !== null && isFilled(outside, fillRule)) {
      const group = groupOf[parent.index] as number;
      groupOf[loop.index] = group;
      groups[group]?.push(loop.index);
    } else {
      groupOf[loop.index] = groups.push([loop.index]) - 1;
    }
  }
}

function isFilled(coverage: Coverage, fillRule: ShapeFillRule): boolean {
  return fillRule === 'nonzero' ? coverage.winding !== 0 : coverage.count % 2 === 1;
}

function closedLoop(path: ColoredPath, index: number): Loop | null {
  const points = loopPoints(path, index);
  if (points === null) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const signedArea = signedAreaMm2(points);
  const area = Math.abs(signedArea);
  if (!(area > 0)) return null;
  const scale = Math.max(1, Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY));
  const direction = signedArea > 0 ? 1 : -1;
  return { index, points, minX, minY, maxX, maxY, area, direction, eps: scale * RELATIVE_EPS };
}

function loopPoints(path: ColoredPath, index: number): ReadonlyArray<Vec2> | null {
  const points = path.curves === undefined ? polylineLoop(path, index) : curveLoop(path, index);
  return points !== null && points.length >= MIN_LOOP_POINTS ? points : null;
}

function polylineLoop(path: ColoredPath, index: number): ReadonlyArray<Vec2> | null {
  const polyline = path.polylines[index];
  return polyline?.closed === true ? polyline.points : null;
}

function curveLoop(path: ColoredPath, index: number): ReadonlyArray<Vec2> | null {
  const curves = path.curves ?? [];
  if (curves[index]?.closed !== true) return null;
  // The compatibility view is kept 1:1 with the curves by every writer that
  // sets both; flatten only when it is not.
  const view = path.polylines.length === curves.length ? path.polylines[index] : undefined;
  return view?.points ?? flattenedCurvePoints(path, index);
}

function flattenedCurvePoints(path: ColoredPath, index: number): ReadonlyArray<Vec2> | null {
  const curve = path.curves?.[index];
  if (curve === undefined) return null;
  const result = flattenCurveSubpath(curve, { toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM });
  return result.kind === 'ok' ? result.polyline.points : null;
}
