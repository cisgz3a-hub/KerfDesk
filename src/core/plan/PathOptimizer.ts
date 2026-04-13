/**
 * 2-opt path optimization — reorders cut paths to minimize total travel distance.
 * Nearest-neighbor for initial ordering, then capped 2-opt refinement.
 *
 * Scaling (path count): ≤50 → 50 iterations; 51–100 → 15; 101–300 → 3; >300 → NN only.
 * A 2s wall-clock cap inside 2-opt is a safety net on pathological inputs.
 *
 * This reduces idle laser travel by 30-60% on typical jobs with many small shapes.
 */

/** Hard stop for 2-opt inner loop (ms) — tiered iteration limits should make this rare. */
const TWO_OPT_WALL_MS = 2000;

import { type FlatPath } from '../job/Job';

interface Point {
  x: number;
  y: number;
}

/** Get the start point of a path */
function pathStart(path: FlatPath): Point {
  const coords = path.coords;
  return { x: coords[0], y: coords[1] };
}

/** Get the end point of a path */
function pathEnd(path: FlatPath): Point {
  const coords = path.coords;
  const n = coords.length / 2;
  if (n < 1) return { x: coords[0] ?? 0, y: coords[1] ?? 0 };
  const i = n - 1;
  return { x: coords[i * 2], y: coords[i * 2 + 1] };
}

/** Euclidean distance between two points */
function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Calculate total travel distance between consecutive paths */
function totalTravel(paths: FlatPath[], startPos: Point = { x: 0, y: 0 }): number {
  let total = 0;
  let current: Point = { ...startPos };
  for (const path of paths) {
    total += dist(current, pathStart(path));
    current = pathEnd(path);
  }
  return total;
}

/**
 * Nearest-neighbor greedy ordering.
 * Start from startPos, always pick the closest unvisited path start.
 */
function nearestNeighbor(paths: FlatPath[], startPos: Point = { x: 0, y: 0 }): FlatPath[] {
  if (paths.length <= 1) return [...paths];

  const remaining = new Set(paths.map((_, i) => i));
  const ordered: FlatPath[] = [];
  let current: Point = { ...startPos };

  while (remaining.size > 0) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (const idx of remaining) {
      const d = dist(current, pathStart(paths[idx]));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    }

    remaining.delete(bestIdx);
    ordered.push(paths[bestIdx]);
    current = pathEnd(paths[bestIdx]);
  }

  return ordered;
}

/**
 * 2-opt improvement — iteratively reverse segments to reduce total travel.
 * Runs until no improvement found or max iterations reached.
 */
function twoOpt(
  paths: FlatPath[],
  maxIterations: number,
  startPos: Point = { x: 0, y: 0 },
): FlatPath[] {
  if (paths.length <= 2) return paths;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wallStart = now();

  let best = [...paths];
  let bestTravel = totalTravel(best, startPos);
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    if (now() - wallStart > TWO_OPT_WALL_MS) break;

    improved = false;
    iterations++;

    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        // Try reversing the segment between i and j
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];

        const candidateTravel = totalTravel(candidate, startPos);
        if (candidateTravel < bestTravel - 0.01) { // Small epsilon to avoid floating point noise
          best = candidate;
          bestTravel = candidateTravel;
          improved = true;
          break; // Restart inner loop
        }
      }
      if (improved) break; // Restart outer loop
    }
  }

  return best;
}

/**
 * Optimize path ordering to minimize total travel distance.
 * Uses nearest-neighbor + 2-opt refinement.
 *
 * @param paths Array of flat paths to reorder
 * @param startPos Current head position (defaults to origin)
 * @returns Reordered paths with minimized travel distance
 */
export function optimizePathOrder(
  paths: FlatPath[],
  startPos: Point = { x: 0, y: 0 },
): FlatPath[] {
  if (paths.length <= 1) return paths;

  const greedy = nearestNeighbor(paths, startPos);
  const n = paths.length;

  // 2-opt cost grows ~O(n²) per iteration; cap iterations by size, skip entirely when huge.
  let maxIter: number;
  if (n <= 50) maxIter = 50;
  else if (n <= 100) maxIter = 15;
  else if (n <= 300) maxIter = 3;
  else return greedy;

  return twoOpt(greedy, maxIter, startPos);
}

/**
 * Get optimization stats for display.
 */
export function getOptimizationStats(
  original: FlatPath[],
  optimized: FlatPath[],
  startPos: Point = { x: 0, y: 0 },
): {
  originalTravel: number;
  optimizedTravel: number;
  savedTravel: number;
  savedPercent: number;
} {
  const originalTravel = totalTravel(original, startPos);
  const optimizedTravel = totalTravel(optimized, startPos);
  const savedTravel = originalTravel - optimizedTravel;
  const savedPercent = originalTravel > 0 ? (savedTravel / originalTravel) * 100 : 0;

  return { originalTravel, optimizedTravel, savedTravel, savedPercent };
}
