/**
 * === FILE: /src/core/plan/PlanOptimizer.ts ===
 *
 * Purpose:    Converts a Job into an optimized Plan. This is the
 *             critical middle stage of the pipeline: Job → Plan.
 *
 *             Current scope (Step 18, iteration 1):
 *             - Vector CUT and SCORE operations only
 *             - Nearest-neighbor path ordering
 *             - Explicit laserOn / laserOff bracketing
 *             - Multi-pass support
 *             - Air assist insertion
 *
 *             NOT yet implemented:
 *             - Fill / engrave scanline generation
 *             - Raster / image scanline generation
 *             - 2-opt / cluster optimization
 *             - Inside-first ordering
 *
 * Pipeline:   Job → [optimizePlan()] → Plan
 *
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/job/Job.ts
 *   - /src/core/plan/Plan.ts
 * Last updated: Phase 5, Step 18c — Fill scanline generation
 */

import { type Point, type AABB, emptyAABB, mergeAABB } from '../types';
import {
  type Job, type Operation, type FlatPath,
  type ResolvedLaserSettings,
} from '../job/Job';
import {
  type Plan, type PlannedOperation, type Move,
  createEmptyPlan, calculatePlanStats,
} from './Plan';
import {
  applyInsideFirstOrder,
  buildContainmentTree,
  type ContainmentNode,
} from './ContainmentOrder';
import {
  generateFillScanlines,
  type FillSettings,
  type ScanlineSegment,
} from './FillGenerator';
import {
  generateRasterScanlines,
  type RasterSettings,
  type RasterScanline,
} from './RasterGenerator';

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Convert a compiled Job into an optimized, executable Plan.
 *
 * The Plan contains only atomic Move objects. After this function
 * returns, the Job is no longer needed for execution — the Plan
 * is fully self-contained.
 */
export function optimizePlan(job: Job): Plan {
  const plan = createEmptyPlan(job.id);
  let currentPos: Point = { x: 0, y: 0 };

  for (const operation of job.operations) {
    const planned = planOperation(operation, currentPos);
    if (planned.length === 0) continue;

    plan.operations.push(...planned);

    // Track laser head position across operations
    currentPos = getFinalPosition(planned);
  }

  // Compute bounds from all moves
  plan.bounds = computePlanBounds(plan);

  // Calculate statistics with trapezoidal velocity model
  plan.stats = calculatePlanStats(plan);

  return plan;
}

// ─── OPERATION PLANNING ──────────────────────────────────────────

/**
 * Plan a single Operation into one or more PlannedOperations.
 * Multiple PlannedOperations are produced for multi-pass jobs.
 */
function planOperation(
  operation: Operation,
  startPos: Point
): PlannedOperation[] {
  const results: PlannedOperation[] = [];
  const settings = operation.settings;

  // Multi-pass: repeat the entire operation N times
  for (let pass = 0; pass < settings.passes; pass++) {
    const moves: Move[] = [];
    let pos = pass === 0 ? startPos : getFinalPositionFromMoves(results[results.length - 1]?.moves || []) || startPos;

    // Air assist ON at start of operation (if enabled)
    if (settings.airAssist && pass === 0) {
      moves.push({ type: 'setAir', on: true });
    }

    // Z offset for this pass
    if (pass > 0 && settings.zStepPerPass !== 0) {
      moves.push({ type: 'setZ', z: settings.zStepPerPass * pass });
    }

    // ─── DISPATCH BY GEOMETRY TYPE ─────────────────────────────
    if (operation.geometry.type === 'raster') {
      // RASTER: Convert bitmap pixels to scanline moves
      const rasterMoves = planRasterOperation(
        operation.geometry.bitmap,
        settings,
        pos
      );
      moves.push(...rasterMoves);
    } else if (operation.geometry.type === 'fill') {
      // FILL: Generate scanlines from boundary paths
      const fillMoves = planFillOperation(
        operation.geometry.paths,
        settings,
        pos
      );
      moves.push(...fillMoves);
    } else {
      // VECTOR (cut/score): Outline paths with inside-first ordering
      const paths = operation.geometry.paths;
      if (paths.length > 0) {
        const ordered = orderPathsForCutting(paths, pos, settings.insideFirst);
        for (const { path, reversed } of ordered) {
          const pathMoves = planPath(path, reversed, settings);
          moves.push(...pathMoves);
          pos = getPathEndpoint(path, reversed);
        }
      }
    }

    // Air assist OFF at end of operation (if enabled, last pass only)
    if (settings.airAssist && pass === settings.passes - 1) {
      moves.push({ type: 'setAir', on: false });
    }

    results.push({
      operationId: operation.id,
      layerName: operation.layerName,
      layerColor: operation.layerColor,
      passIndex: pass,
      moves,
    });
  }

  return results;
}

// ─── PATH TO MOVES ───────────────────────────────────────────────

/**
 * Convert a single FlatPath into a sequence of Moves.
 *
 * Produces:
 *   1. rapid  → move to path start (laser off)
 *   2. laserOn  → turn laser on at configured power
 *   3. linear → follow path points (laser cutting)
 *   4. linear → close path (if closed, back to first point)
 *   5. laserOff → turn laser off
 */
function planPath(
  path: FlatPath,
  reversed: boolean,
  settings: ResolvedLaserSettings
): Move[] {
  const coords = path.coords;
  const n = coords.length / 2;
  if (n < 2) return [];

  const moves: Move[] = [];
  const power = settings.powerMax * (path.powerScale ?? 1.0);
  const speed = settings.speed;

  // Build point index order
  const indices = reversed
    ? Array.from({ length: n }, (_, i) => n - 1 - i)
    : Array.from({ length: n }, (_, i) => i);

  // 1. Rapid to start point
  const startIdx = indices[0];
  moves.push({
    type: 'rapid',
    to: { x: coords[startIdx * 2], y: coords[startIdx * 2 + 1] },
  });

  // 2. Laser ON
  moves.push({
    type: 'laserOn',
    power,
  });

  // Lead-in — approach the start point from slightly before it
  // This allows the laser to reach full speed before the actual cut begins
  if (path.closed && settings.leadIn > 0) {
    if (n >= 2) {
      // Get direction from second-to-last point to first point (approach direction)
      const lastIdx = indices[indices.length - 1];
      const lastX = coords[lastIdx * 2];
      const lastY = coords[lastIdx * 2 + 1];
      const firstX = coords[indices[0] * 2];
      const firstY = coords[indices[0] * 2 + 1];

      const dx = firstX - lastX;
      const dy = firstY - lastY;
      const len = Math.sqrt(dx * dx + dy * dy);

      if (len > 0.001) {
        // Start the rapid move at the lead-in position (before the actual start)
        const leadInX = firstX - (dx / len) * settings.leadIn;
        const leadInY = firstY - (dy / len) * settings.leadIn;

        // Override the rapid destination to the lead-in point
        moves[0] = {
          type: 'rapid',
          to: { x: leadInX, y: leadInY },
        };

        // Add a laser-on cut from lead-in to the actual start point
        // This goes right after laserOn
        const laserOnIndex = moves.findIndex(m => m.type === 'laserOn');
        if (laserOnIndex >= 0) {
          moves.splice(laserOnIndex + 1, 0, {
            type: 'linear',
            to: { x: firstX, y: firstY },
            power,
            speed,
          });
        }
      }
    }
  }

  // 3. Linear moves along path (with optional tabs on closed paths)
  type PathSeg = { fromX: number; fromY: number; toX: number; toY: number; len: number };
  const segments: PathSeg[] = [];
  let totalLength = 0;
  for (let i = 1; i < indices.length; i++) {
    const prevIdx = indices[i - 1];
    const currIdx = indices[i];
    const fromX = coords[prevIdx * 2];
    const fromY = coords[prevIdx * 2 + 1];
    const toX = coords[currIdx * 2];
    const toY = coords[currIdx * 2 + 1];
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    segments.push({ fromX, fromY, toX, toY, len });
    totalLength += len;
  }
  if (path.closed && n > 2) {
    const lastIdx = indices[indices.length - 1];
    const firstIdx = indices[0];
    const fromX = coords[lastIdx * 2];
    const fromY = coords[lastIdx * 2 + 1];
    const toX = coords[firstIdx * 2];
    const toY = coords[firstIdx * 2 + 1];
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    segments.push({ fromX, fromY, toX, toY, len });
    totalLength += len;
  }

  const tabPositions: Array<{ startDist: number; endDist: number }> = [];
  if (path.closed && settings.tabCount > 0 && settings.tabWidth > 0 && totalLength > 0) {
    const spacing = totalLength / settings.tabCount;
    for (let t = 0; t < settings.tabCount; t++) {
      const center = spacing * (t + 0.5);
      const halfTab = settings.tabWidth / 2;
      tabPositions.push({
        startDist: Math.max(0, center - halfTab),
        endDist: Math.min(totalLength, center + halfTab),
      });
    }
  }

  function isInTab(dist: number): boolean {
    for (const tab of tabPositions) {
      if (dist >= tab.startDist && dist <= tab.endDist) return true;
    }
    return false;
  }

  if (tabPositions.length === 0) {
    for (const seg of segments) {
      moves.push({
        type: 'linear',
        to: { x: seg.toX, y: seg.toY },
        power,
        speed,
      });
    }
  } else {
    let laserIsOn = true;
    let cumulativeDist = 0;
    for (const seg of segments) {
      const { fromX, fromY, toX, toY, len: segLen } = seg;
      const segStart = cumulativeDist;
      if (segLen < 1e-12) {
        cumulativeDist += segLen;
        continue;
      }
      const critical: number[] = [segStart, segStart + segLen];
      for (const tab of tabPositions) {
        if (tab.startDist > segStart && tab.startDist < segStart + segLen) critical.push(tab.startDist);
        if (tab.endDist > segStart && tab.endDist < segStart + segLen) critical.push(tab.endDist);
      }
      critical.sort((a, b) => a - b);
      const uniq: number[] = [];
      for (const c of critical) {
        if (uniq.length === 0 || Math.abs(c - uniq[uniq.length - 1]) > 1e-9) uniq.push(c);
      }
      for (let k = 0; k < uniq.length - 1; k++) {
        const d0 = uniq[k];
        const d1 = uniq[k + 1];
        if (d1 - d0 < 1e-9) continue;
        const mid = (d0 + d1) / 2;
        const t1 = (d1 - segStart) / segLen;
        const px = fromX + (toX - fromX) * t1;
        const py = fromY + (toY - fromY) * t1;
        const inTab = isInTab(mid);
        if (inTab) {
          if (laserIsOn) {
            moves.push({ type: 'laserOff' });
            laserIsOn = false;
          }
          moves.push({ type: 'rapid', to: { x: px, y: py } });
        } else {
          if (!laserIsOn) {
            moves.push({ type: 'laserOn', power });
            laserIsOn = true;
          }
          moves.push({ type: 'linear', to: { x: px, y: py }, power, speed });
        }
      }
      cumulativeDist += segLen;
    }

    if (!laserIsOn && (path.closed || settings.overcut > 0)) {
      moves.push({ type: 'laserOn', power });
    }
  }

  // Overcut — continue past the start point on closed paths
  // This ensures the cut fully separates the piece
  if (path.closed && settings.overcut > 0) {
    if (n >= 2) {
      // Get the direction from the last point to the first point
      const firstX = coords[indices[0] * 2];
      const firstY = coords[indices[0] * 2 + 1];
      // Get the second point to determine the direction the path continues
      const secondIdx = indices.length > 1 ? indices[1] : indices[0];
      const secondX = coords[secondIdx * 2];
      const secondY = coords[secondIdx * 2 + 1];

      // Direction from first to second point
      const dx = secondX - firstX;
      const dy = secondY - firstY;
      const len = Math.sqrt(dx * dx + dy * dy);

      if (len > 0.001) {
        // Normalize and extend by overcut distance
        const overcutX = firstX + (dx / len) * settings.overcut;
        const overcutY = firstY + (dy / len) * settings.overcut;

        moves.push({
          type: 'linear',
          to: { x: overcutX, y: overcutY },
          power,
          speed,
        });
      }
    }
  }

  // 5. Laser OFF
  moves.push({ type: 'laserOff' });

  return moves;
}

// ─── FILL OPERATION TO MOVES ─────────────────────────────────────

/**
 * Convert a fill operation's boundary paths into scanline moves.
 *
 * Produces:
 *   For each scanline segment:
 *     1. rapid   → move to segment start
 *     2. laserOn → turn laser on
 *     3. linear  → scan to segment end
 *     4. laserOff → turn laser off
 *
 * Scanlines are generated at the configured interval and angle.
 * Bidirectional scanning alternates direction per line.
 * Overscanning extends beyond boundaries for acceleration room.
 */
function planFillOperation(
  boundaryPaths: FlatPath[],
  settings: ResolvedLaserSettings,
  startPos: Point
): Move[] {
  const fillSettings: FillSettings = {
    interval: settings.fillInterval,
    angle: settings.fillAngle,
    biDirectional: settings.fillBiDirectional,
    overscanning: settings.overscanning,
  };

  const scanlines = generateFillScanlines(boundaryPaths, fillSettings);
  if (scanlines.length === 0) return [];

  const moves: Move[] = [];
  const power = settings.powerMax;
  const speed = settings.speed;

  for (const segment of scanlines) {
    // 1. Rapid to start of scanline
    moves.push({
      type: 'rapid',
      to: { x: segment.from.x, y: segment.from.y },
    });

    // 2. Laser ON
    moves.push({
      type: 'laserOn',
      power,
    });

    // 3. Linear scan across
    moves.push({
      type: 'linear',
      to: { x: segment.to.x, y: segment.to.y },
      power,
      speed,
    });

    // 4. Laser OFF
    moves.push({ type: 'laserOff' });
  }

  return moves;
}

// ─── RASTER OPERATION TO MOVES ───────────────────────────────────

/**
 * Convert a raster operation's bitmap into scanline moves.
 *
 * For each non-empty row of pixels, generates burn segments:
 *   1. rapid   → move to segment start
 *   2. laserOn → at segment's power level
 *   3. linear  → scan to segment end
 *   4. laserOff
 *
 * Empty rows are skipped. Bidirectional mode alternates direction.
 * 8-bit mode produces variable power per segment.
 */
function planRasterOperation(
  bitmap: import('../job/Job').ProcessedBitmap,
  settings: ResolvedLaserSettings,
  startPos: Point
): Move[] {
  const rasterSettings: RasterSettings = {
    powerMin: settings.powerMin,
    powerMax: settings.powerMax,
    speed: settings.speed,
    biDirectional: settings.fillBiDirectional,
    overscanning: settings.overscanning,
  };

  const scanlines = generateRasterScanlines(bitmap, rasterSettings);
  if (scanlines.length === 0) return [];

  const moves: Move[] = [];
  const speed = settings.speed;

  for (const scanline of scanlines) {
    for (const segment of scanline.segments) {
      // 1. Rapid to start of segment
      moves.push({
        type: 'rapid',
        to: { x: segment.startX, y: segment.y },
      });

      // 2. Laser ON at segment's power
      moves.push({
        type: 'laserOn',
        power: segment.power,
      });

      // 3. Linear scan to end
      moves.push({
        type: 'linear',
        to: { x: segment.endX, y: segment.y },
        power: segment.power,
        speed,
      });

      // 4. Laser OFF
      moves.push({ type: 'laserOff' });
    }
  }

  return moves;
}

// ─── PATH ORDERING (INSIDE-FIRST + NEAREST-NEIGHBOR) ─────────────

/**
 * Order paths for cutting with two constraints:
 * 1. Inner paths must be cut before outer paths (containment safety)
 * 2. Within each containment depth, minimize travel (nearest-neighbor)
 *
 * When insideFirst is false, falls back to pure nearest-neighbor.
 */
function orderPathsForCutting(
  paths: FlatPath[],
  startPos: Point,
  insideFirst: boolean
): OrderedPath[] {
  if (!insideFirst || paths.length <= 1) {
    return nearestNeighborOrder(paths, startPos);
  }

  // Separate closed and open paths
  const closed: FlatPath[] = [];
  const open: FlatPath[] = [];
  for (const p of paths) {
    (p.closed ? closed : open).push(p);
  }

  // If no closed paths, just nearest-neighbor the open ones
  if (closed.length === 0) {
    return nearestNeighborOrder(open, startPos);
  }

  // Build containment tree and get depth-grouped paths
  const depthGroups = getDepthGroups(closed);
  const result: OrderedPath[] = [];
  let pos = startPos;

  // Process from deepest to shallowest (inner before outer)
  const maxDepth = Math.max(...depthGroups.keys());
  for (let depth = maxDepth; depth >= 0; depth--) {
    const group = depthGroups.get(depth);
    if (!group || group.length === 0) continue;

    // Within this depth level, apply nearest-neighbor
    const ordered = nearestNeighborOrder(group, pos);
    result.push(...ordered);

    // Update position to end of last path in this group
    if (ordered.length > 0) {
      const last = ordered[ordered.length - 1];
      pos = getPathEndpoint(last.path, last.reversed);
    }
  }

  // Open paths go last, nearest-neighbor ordered
  if (open.length > 0) {
    result.push(...nearestNeighborOrder(open, pos));
  }

  return result;
}

/**
 * Build containment tree and return paths grouped by depth.
 * Depth 0 = outermost (roots), higher = more nested.
 */
function getDepthGroups(closedPaths: FlatPath[]): Map<number, FlatPath[]> {
  const tree = buildContainmentTree(closedPaths);
  const groups = new Map<number, FlatPath[]>();

  function collect(nodes: ContainmentNode[]): void {
    for (const node of nodes) {
      const group = groups.get(node.depth) || [];
      group.push(node.path);
      groups.set(node.depth, group);
      collect(node.children);
    }
  }

  collect(tree);
  return groups;
}

// ─── NEAREST-NEIGHBOR PATH ORDERING ──────────────────────────────

interface OrderedPath {
  path: FlatPath;
  reversed: boolean;
}

/**
 * Greedy nearest-neighbor ordering.
 *
 * For each unvisited path, find the one whose start or end is
 * closest to the current position. If the end is closer, the
 * path will be traversed in reverse.
 *
 * Complexity: O(n²) where n = number of paths.
 * Quality: ~70% of optimal. Good enough for MVP.
 */
function nearestNeighborOrder(
  paths: FlatPath[],
  startPos: Point
): OrderedPath[] {
  if (paths.length === 0) return [];
  if (paths.length === 1) {
    return [{ path: paths[0], reversed: false }];
  }

  const remaining = new Set<number>(paths.map((_, i) => i));
  const result: OrderedPath[] = [];
  let pos = startPos;

  while (remaining.size > 0) {
    let bestIdx = -1;
    let bestDist = Infinity;
    let bestReversed = false;

    for (const idx of remaining) {
      const path = paths[idx];

      // Distance to path start
      const start = getPathStart(path);
      const dStart = distanceSq(pos, start);

      // Distance to path end (could traverse in reverse)
      const end = getPathEnd(path);
      const dEnd = distanceSq(pos, end);

      if (dStart < bestDist) {
        bestDist = dStart;
        bestIdx = idx;
        bestReversed = false;
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        bestIdx = idx;
        bestReversed = true;
      }
    }

    remaining.delete(bestIdx);
    const path = paths[bestIdx];
    result.push({ path, reversed: bestReversed });

    // Update position to the endpoint of the path we just added
    pos = getPathEndpoint(path, bestReversed);
  }

  return result;
}

// ─── FLATPATH COORDINATE HELPERS ─────────────────────────────────

function getPathStart(path: FlatPath): Point {
  return { x: path.coords[0], y: path.coords[1] };
}

function getPathEnd(path: FlatPath): Point {
  const n = path.coords.length;
  return { x: path.coords[n - 2], y: path.coords[n - 1] };
}

/**
 * Get the point where the laser head ends up after traversing
 * a path (accounting for direction and closed-path return).
 */
function getPathEndpoint(path: FlatPath, reversed: boolean): Point {
  if (path.closed) {
    // Closed paths return to start, regardless of direction
    return reversed ? getPathEnd(path) : getPathStart(path);
  }
  return reversed ? getPathStart(path) : getPathEnd(path);
}

// ─── POSITION TRACKING ──────────────────────────────────────────

function getFinalPosition(ops: PlannedOperation[]): Point {
  if (ops.length === 0) return { x: 0, y: 0 };
  const lastOp = ops[ops.length - 1];
  return getFinalPositionFromMoves(lastOp.moves) || { x: 0, y: 0 };
}

function getFinalPositionFromMoves(moves: Move[]): Point | null {
  for (let i = moves.length - 1; i >= 0; i--) {
    const move = moves[i];
    if (move.type === 'rapid' || move.type === 'linear') {
      return { ...move.to };
    }
  }
  return null;
}

// ─── PLAN BOUNDS ─────────────────────────────────────────────────

function computePlanBounds(plan: Plan): AABB {
  let bounds = emptyAABB();

  for (const op of plan.operations) {
    for (const move of op.moves) {
      if (move.type === 'rapid' || move.type === 'linear') {
        bounds = mergeAABB(bounds, {
          minX: move.to.x, minY: move.to.y,
          maxX: move.to.x, maxY: move.to.y,
        });
      }
    }
  }

  return bounds;
}

// ─── MATH ────────────────────────────────────────────────────────

function distanceSq(a: Point, b: Point): number {
  return (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
}
