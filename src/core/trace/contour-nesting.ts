// Containment forest of the contour tracer's boundary loops (ADR-483), built
// once, exactly, on the pixel-corner lattice before any smoothing moves a
// vertex.
//
// Every boundary loop is a closed walk of unit lattice steps, and each
// vertical crack (the side between two horizontally adjacent pixels) belongs
// to exactly one loop. A scan line through the pixel centres of a row
// therefore meets each loop only at its vertical cracks of that row, at
// distinct integer x, and never at a vertex, so loops that touch at a saddle
// corner cannot be confused with loops that cross. Loops never cross, so the
// spans a row's crossings open and close are properly nested: sweeping the row
// left to right with a stack, a loop's crack closes a span when that loop is on
// top of the stack and opens one otherwise, and the loop open beneath a newly
// opened span is the smallest loop around it: its parent. One sweep of every
// row costs O(E log E) for E vertical cracks and uses no floating point.

import { type ColoredPath, type Polyline, type Vec2 } from '../scene';
import { withSubpathNesting } from '../scene/subpath-nesting';
import { withCanonicalTraceCurves } from './trace-curves';

/** A closed lattice walk, as `traceBoundaryLoops` returns it. */
export type LatticeLoop = {
  readonly points: ReadonlyArray<Vec2>;
  readonly area: number;
};

/** Finished outlines in boundary scan order and, when the lattice forest was
 *  valid, the parent of each one (a position in `polylines`, or -1). */
export type NestedContourRings = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly parents: Int32Array | null;
};

const NO_PARENT = -1;
const UNSEEN = -2;
// Crack keys pack x above the loop index; both stay below 2^26, so the
// product stays an exact double.
const LOOP_KEY_RANGE = 2 ** 26;

/**
 * For each loop, the index of the smallest loop that contains it, or -1.
 * Null when the loops are not a valid lattice boundary set (a loop off the
 * lattice, crossing spans), so a caller keeps its fallback instead of a wrong
 * tree. On a valid set the depth parity matches the orientation: loops at even
 * depth have positive area (ink boundaries), loops at odd depth negative.
 */
export function latticeLoopParents(loops: ReadonlyArray<LatticeLoop>): Int32Array | null {
  if (loops.length >= LOOP_KEY_RANGE) return null;
  const cracks = verticalCracksByRow(loops);
  if (cracks === null) return null;
  const parents = new Int32Array(loops.length).fill(UNSEEN);
  const open = new Uint8Array(loops.length);
  for (let row = 0; row < cracks.rows.length - 1; row += 1) {
    const from = cracks.rows[row] as number;
    const to = cracks.rows[row + 1] as number;
    if (to > from && !sweepRow(cracks.keys.subarray(from, to).sort(), parents, open)) return null;
  }
  // A loop without a vertical crack spans no row: not a lattice loop.
  if (parents.some((parent) => parent === UNSEEN)) return null;
  return depthParityMatchesOrientation(loops, parents) ? parents : null;
}

// One row, left to right: a loop's crack closes its span when that loop is on
// top of the stack and opens one otherwise; the loop beneath a new span is its
// parent. False when the spans are not nested or disagree with earlier rows.
function sweepRow(keys: Float64Array, parents: Int32Array, open: Uint8Array): boolean {
  const stack: number[] = [];
  for (const key of keys) {
    const loop = key % LOOP_KEY_RANGE;
    if (stack.at(-1) === loop) {
      stack.pop();
      open[loop] = 0;
      continue;
    }
    // Open beneath another span: the spans of this row are not nested.
    if (open[loop] === 1) return false;
    const around = stack.at(-1) ?? NO_PARENT;
    const known = parents[loop] as number;
    if (known !== UNSEEN && known !== around) return false;
    parents[loop] = around;
    stack.push(loop);
    open[loop] = 1;
  }
  return stack.length === 0;
}

type RowCracks = {
  /** Row r's cracks are keys[rows[r] .. rows[r + 1]). */
  readonly rows: Int32Array;
  readonly keys: Float64Array;
};

function verticalCracksByRow(loops: ReadonlyArray<LatticeLoop>): RowCracks | null {
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let count = 0;
  for (const loop of loops) {
    const { points } = loop;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i] as Vec2;
      const b = points[(i + 1) % points.length] as Vec2;
      if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return null;
      if (a.x !== b.x) continue;
      const row = Math.min(a.y, b.y);
      if (Math.abs(b.y - a.y) !== 1) return null;
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minX = Math.min(minX, a.x);
      count += 1;
    }
  }
  if (count === 0) return { rows: new Int32Array(1), keys: new Float64Array(0) };
  const rowCount = maxRow - minRow + 1;
  const rows = new Int32Array(rowCount + 1);
  forEachVerticalCrack(loops, (row) => {
    rows[row - minRow + 1] = (rows[row - minRow + 1] as number) + 1;
  });
  for (let r = 0; r < rowCount; r += 1) rows[r + 1] = (rows[r + 1] as number) + (rows[r] as number);
  const fill = rows.slice(0, rowCount);
  const keys = new Float64Array(count);
  let xRangeOk = true;
  forEachVerticalCrack(loops, (row, x, loop) => {
    const shifted = x - minX;
    if (shifted >= LOOP_KEY_RANGE) xRangeOk = false;
    const slot = fill[row - minRow] as number;
    keys[slot] = shifted * LOOP_KEY_RANGE + loop;
    fill[row - minRow] = slot + 1;
  });
  return xRangeOk ? { rows, keys } : null;
}

function forEachVerticalCrack(
  loops: ReadonlyArray<LatticeLoop>,
  visit: (row: number, x: number, loop: number) => void,
): void {
  loops.forEach((loop, index) => {
    const { points } = loop;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i] as Vec2;
      const b = points[(i + 1) % points.length] as Vec2;
      if (a.x === b.x) visit(Math.min(a.y, b.y), a.x, index);
    }
  });
}

function depthParityMatchesOrientation(
  loops: ReadonlyArray<LatticeLoop>,
  parents: Int32Array,
): boolean {
  const depths = forestDepths(parents);
  if (depths === null) return false;
  return loops.every((loop, index) => loop.area > 0 === ((depths[index] as number) % 2 === 0));
}

/** Depth of every node of a parent forest (-1 = root), or null on a cycle. */
export function forestDepths(parents: ArrayLike<number>): Int32Array | null {
  const n = parents.length;
  const depths = new Int32Array(n).fill(-1);
  const chain: number[] = [];
  for (let start = 0; start < n; start += 1) {
    let node = start;
    while (node >= 0 && (depths[node] as number) < 0) {
      if (chain.length > n) return null;
      chain.push(node);
      node = parents[node] as number;
    }
    let depth = node < 0 ? -1 : (depths[node] as number);
    while (chain.length > 0) {
      depth += 1;
      depths[chain.pop() as number] = depth;
    }
  }
  return depths;
}

/**
 * Restrict a parent forest to the kept nodes: each kept node's parent becomes
 * its nearest kept ancestor. `kept` lists original indices; the result is
 * indexed like `kept` and names positions in it.
 */
export function keptForest(parents: ArrayLike<number>, kept: ReadonlyArray<number>): Int32Array {
  const position = new Int32Array(parents.length).fill(NO_PARENT);
  kept.forEach((original, at) => {
    position[original] = at;
  });
  return Int32Array.from(kept, (original) => {
    let ancestor = parents[original] as number;
    while (ancestor >= 0 && (position[ancestor] as number) < 0) {
      ancestor = parents[ancestor] as number;
    }
    return ancestor < 0 ? NO_PARENT : (position[ancestor] as number);
  });
}

/**
 * Pre-order of a parent forest: every root, then depth-first its children, so
 * each outer comes before its holes and each hole before the islands inside
 * it. Siblings keep their input order. Returns the order (input indices) and
 * the parents renumbered to positions in that order.
 */
export function preOrderForest(parents: ArrayLike<number>): {
  readonly order: Int32Array;
  readonly parents: Int32Array;
} {
  const n = parents.length;
  const children: number[][] = Array.from({ length: n }, () => []);
  const roots: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const parent = parents[i] as number;
    if (parent >= 0) children[parent]?.push(i);
    else roots.push(i);
  }
  const order = new Int32Array(n);
  const positionOf = new Int32Array(n);
  let next = 0;
  const pending = roots.reverse();
  while (pending.length > 0) {
    const node = pending.pop() as number;
    positionOf[node] = next;
    order[next] = node;
    next += 1;
    const kids = children[node] as number[];
    for (let k = kids.length - 1; k >= 0; k -= 1) pending.push(kids[k] as number);
  }
  const renumbered = Int32Array.from(order, (node) => {
    const parent = parents[node] as number;
    return parent < 0 ? NO_PARENT : (positionOf[parent] as number);
  });
  return { order, parents: renumbered };
}

/**
 * One filled path from the finished outlines: outers before their holes
 * (pre-order), carrying the forest as `subpathNesting`. The topology repair
 * keeps every outline's orientation equal to its lattice loop's, so outers
 * have positive and holes negative signed area (y down: clockwise and
 * counter-clockwise on screen). The forest is only attached when every
 * outline still shows that orientation, the check that makes even-odd and
 * nonzero filling the same region.
 */
export function nestedContourPath(color: string, rings: NestedContourRings): ColoredPath {
  if (rings.parents === null) {
    return withCanonicalTraceCurves([{ color, polylines: rings.polylines }])[0] as ColoredPath;
  }
  const { order, parents } = preOrderForest(rings.parents);
  const polylines = Array.from(order, (index) => rings.polylines[index] as Polyline);
  const path = withCanonicalTraceCurves([{ color, polylines }])[0] as ColoredPath;
  const depths = forestDepths(parents);
  const oriented =
    depths !== null &&
    polylines.every((ring, at) => {
      const area = signedRingArea(ring.points);
      return (depths[at] as number) % 2 === 0 ? area > 0 : area < 0;
    });
  return oriented ? withSubpathNesting(path, Array.from(parents)) : path;
}

function signedRingArea(points: ReadonlyArray<Vec2>): number {
  let twice = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[j] as Vec2;
    const b = points[i] as Vec2;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}
