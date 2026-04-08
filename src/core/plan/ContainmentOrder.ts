/**
 * === FILE: /src/core/plan/ContainmentOrder.ts ===
 *
 * Purpose:    Determines which closed paths are inside other closed
 *             paths and produces a depth-first ordering where inner
 *             paths are always processed before outer paths.
 *
 *             This prevents the outer shape from falling out before
 *             inner features are cut — the single most important
 *             ordering rule in laser cutting.
 *
 *             Algorithm:
 *             1. Filter to closed paths only
 *             2. For each pair, test containment via point-in-polygon
 *             3. Assign each path to its direct parent (smallest container)
 *             4. Flatten tree: deepest nodes first, then parents
 *
 * Dependencies:
 *   - /src/core/job/Job.ts (FlatPath)
 *   - /src/core/types.ts (AABB)
 * Last updated: Phase 5, Step 18b — Inside-first ordering
 */

import { type FlatPath } from '../job/Job';
import { type AABB, aabbContainsPoint, aabbIntersects } from '../types';

// ─── PUBLIC TYPES ────────────────────────────────────────────────

export interface ContainmentNode {
  path: FlatPath;
  children: ContainmentNode[];
  depth: number;
}

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Reorder paths so that inner paths come before outer paths.
 * Open paths are appended at the end (they have no containment).
 *
 * Returns the same paths in a new order. Does not mutate input.
 */
export function applyInsideFirstOrder(paths: FlatPath[]): FlatPath[] {
  if (paths.length <= 1) return [...paths];

  // Separate closed and open paths
  const closed: FlatPath[] = [];
  const open: FlatPath[] = [];

  for (const p of paths) {
    if (p.closed) {
      closed.push(p);
    } else {
      open.push(p);
    }
  }

  // If 0 or 1 closed paths, no containment to resolve
  if (closed.length <= 1) {
    return [...closed, ...open];
  }

  // Build containment tree and flatten depth-first
  const tree = buildContainmentTree(closed);
  const ordered = flattenContainmentTree(tree);

  // Open paths go after all closed paths
  return [...ordered, ...open];
}

// ─── CONTAINMENT TREE CONSTRUCTION ───────────────────────────────

/**
 * Build a tree of containment relationships.
 *
 * For each closed path, find its direct parent — the smallest
 * closed path that contains it. Paths with no parent are roots.
 *
 * Complexity: O(n²) for n closed paths. Acceptable for < 10,000 paths.
 */
export function buildContainmentTree(closedPaths: FlatPath[]): ContainmentNode[] {
  const n = closedPaths.length;

  // Step 1: Build containment matrix.
  // contains[i][j] = true means path i contains path j.
  const contains: boolean[][] = Array.from({ length: n }, () =>
    new Array(n).fill(false)
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;

      // Quick reject: if bounding boxes don't overlap, no containment
      if (!aabbIntersects(closedPaths[i].bounds, closedPaths[j].bounds)) {
        continue;
      }

      // Test: does path i contain path j?
      // Use the first point of j as the test point.
      const testPoint = {
        x: closedPaths[j].coords[0],
        y: closedPaths[j].coords[1],
      };

      // First check AABB (cheap)
      if (!aabbContainsPoint(closedPaths[i].bounds, testPoint)) {
        continue;
      }

      // Then check actual polygon (expensive)
      if (pointInPolygon(testPoint.x, testPoint.y, closedPaths[i].coords)) {
        contains[i][j] = true;
      }
    }
  }

  // Step 2: Find direct parent for each path.
  // The direct parent of path j is the containing path with the
  // smallest area. This correctly handles nested containment:
  //   A contains B contains C → parent(C) = B, not A.
  const areas = closedPaths.map(p => Math.abs(computeSignedArea(p.coords)));
  const parent: (number | null)[] = new Array(n).fill(null);

  for (let j = 0; j < n; j++) {
    let bestParent: number | null = null;
    let bestArea = Infinity;

    for (let i = 0; i < n; i++) {
      if (contains[i][j] && areas[i] < bestArea) {
        bestArea = areas[i];
        bestParent = i;
      }
    }

    parent[j] = bestParent;
  }

  // Step 3: Build tree from parent array.
  const nodes: ContainmentNode[] = closedPaths.map(path => ({
    path,
    children: [],
    depth: 0,
  }));

  const roots: ContainmentNode[] = [];

  for (let j = 0; j < n; j++) {
    if (parent[j] !== null) {
      nodes[parent[j]!].children.push(nodes[j]);
    } else {
      roots.push(nodes[j]);
    }
  }

  // Step 4: Compute depths.
  function setDepth(node: ContainmentNode, depth: number): void {
    node.depth = depth;
    for (const child of node.children) {
      setDepth(child, depth + 1);
    }
  }
  for (const root of roots) {
    setDepth(root, 0);
  }

  return roots;
}

// ─── TREE FLATTENING ─────────────────────────────────────────────

/**
 * Flatten the containment tree so that deepest nodes come first.
 *
 * For each node: emit all children (recursively) BEFORE the node itself.
 * This guarantees inner shapes are cut before outer shapes.
 *
 * Within the same parent's children, the original order is preserved.
 * (The nearest-neighbor optimizer will re-sort within each depth level.)
 */
export function flattenContainmentTree(roots: ContainmentNode[]): FlatPath[] {
  const result: FlatPath[] = [];

  function visit(node: ContainmentNode): void {
    // Children first (they are deeper / more inner)
    for (const child of node.children) {
      visit(child);
    }
    // Then this node
    result.push(node.path);
  }

  for (const root of roots) {
    visit(root);
  }

  return result;
}

// ─── POINT-IN-POLYGON (RAY CASTING) ─────────────────────────────

/**
 * Test if a point (px, py) is inside a polygon defined by a
 * flat coordinate array [x0, y0, x1, y1, ...].
 *
 * Uses the ray casting algorithm: cast a horizontal ray from the
 * test point to the right and count edge crossings. Odd = inside.
 *
 * Complexity: O(n) for n vertices.
 */
function pointInPolygon(
  px: number,
  py: number,
  coords: Float64Array
): boolean {
  const n = coords.length / 2;
  if (n < 3) return false;

  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = coords[i * 2];
    const yi = coords[i * 2 + 1];
    const xj = coords[j * 2];
    const yj = coords[j * 2 + 1];

    // Does the edge from (xj, yj) to (xi, yi) cross the horizontal ray?
    if ((yi > py) !== (yj > py)) {
      // Compute x-coordinate of intersection
      const intersectX = xj + ((py - yj) / (yi - yj)) * (xi - xj);
      if (px < intersectX) {
        inside = !inside;
      }
    }
  }

  return inside;
}

// ─── SIGNED AREA ─────────────────────────────────────────────────

/**
 * Compute the signed area of a polygon from flat coordinates.
 * Uses the shoelace formula.
 * Positive = counter-clockwise, Negative = clockwise.
 * Absolute value = area used for finding smallest container.
 */
function computeSignedArea(coords: Float64Array): number {
  const n = coords.length / 2;
  if (n < 3) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = coords[i * 2];
    const yi = coords[i * 2 + 1];
    const xj = coords[j * 2];
    const yj = coords[j * 2 + 1];
    sum += (xj - xi) * (yj + yi);
  }

  return sum / 2;
}
