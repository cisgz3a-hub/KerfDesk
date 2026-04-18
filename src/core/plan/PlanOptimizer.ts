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
 *             - Cluster optimization beyond 2-opt
 *
 *             Implemented: fill scanlines (incl. cross-hatch), raster scanlines,
 *             inside-first ordering, 2-opt path order + direction choice.
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
  generateFillRows,
  type FillSettings,
  type FillScanlineRow,
} from './FillGenerator';
import {
  generateRasterScanlines,
  type RasterSettings,
  type RasterScanline,
} from './RasterGenerator';
import { optimizePathOrder } from './PathOptimizer';
import {
  computeVelocityZones,
  velocityAt,
  scalePowerByVelocity,
  type MoveKinematics,
} from './VelocityProfile';
import { interpolateOffset, applyScanOffset } from './ScanningOffset';

// ─── PUBLIC API ──────────────────────────────────────────────────

export interface OptimizePlanConfig {
  /** Max rapid travel speed in mm/min (default 6000). */
  maxRapidSpeed?: number;
  /** Max acceleration in mm/s² (default 500). */
  maxAcceleration?: number;
}

/**
 * Convert a compiled Job into an optimized, executable Plan.
 *
 * The Plan contains only atomic Move objects. After this function
 * returns, the Job is no longer needed for execution — the Plan
 * is fully self-contained.
 */
export function optimizePlan(job: Job, config?: OptimizePlanConfig): Plan {
  const plan = createEmptyPlan(job.id);
  let currentPos: Point = { x: 0, y: 0 };

  for (const operation of job.operations) {
    const planned = planOperation(operation, currentPos);
    if (planned.length === 0) continue;

    for (let i = 0; i < planned.length; i++) {
      plan.operations.push(planned[i]);
    }

    // Track laser head position across operations
    currentPos = getFinalPosition(planned);
  }

  // Compute bounds from all moves
  plan.bounds = computePlanBounds(plan);

  plan.stats = calculatePlanStats(
    plan,
    config?.maxAcceleration ?? 500,
    config?.maxRapidSpeed ?? 6000,
  );

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
      for (let i = 0; i < rasterMoves.length; i++) {
        moves.push(rasterMoves[i]);
      }
    } else if (operation.type === 'engrave' && operation.geometry.type === 'fill') {
      // FILL: engrave only — never infer from fillInterval on cut/score jobs
      const fillMoves = planFillOperation(
        operation.geometry.paths,
        settings,
        pos
      );
      for (let i = 0; i < fillMoves.length; i++) {
        moves.push(fillMoves[i]);
      }
    } else {
      // VECTOR (cut/score): Outline paths with inside-first ordering
      const paths = operation.geometry.paths;
      if (paths.length > 0) {
        const ordered = orderPathsForCutting(paths, pos, settings.insideFirst);
        for (const { path, reversed } of ordered) {
          const pathMoves = planPath(path, reversed, settings);
          for (let i = 0; i < pathMoves.length; i++) {
            moves.push(pathMoves[i]);
          }
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
 * Uses continuous motion across each scanline row with inline S-value
 * toggling instead of per-segment M4/M5 cycling. This matches the
 * GRBL laser mode spec and LightBurn's approach:
 *
 *   - M4 S0 set ONCE at the start (dynamic laser mode, initially off)
 *   - Per row: rapid to overscan start → G1 S0 approach → G1 S{power}
 *     burn → G1 S0 gap → G1 S{power} burn → ... → G1 S0 exit
 *   - M5 S0 ONCE at the end
 *
 * Per GRBL docs, M4 does NOT stop for inline S changes — the machine
 * maintains constant velocity. This eliminates the acceleration/power
 * loss that occurred with per-segment M4/M5 cycling.
 *
 * Overscanning extends the MOTION (laser off) beyond the actual shape
 * boundary, giving the machine room to accelerate before the laser
 * turns on and decelerate after it turns off.
 */
function planFillOperation(
  boundaryPaths: FlatPath[],
  settings: ResolvedLaserSettings,
  startPos: Point
): Move[] {
  const fillMode = settings.fillMode ?? 'line';
  const baseAngle = settings.fillAngle;
  const fillAngles: number[] =
    fillMode === 'cross-hatch' ? [baseAngle, baseAngle + 90] : [baseAngle];

  const interval = Math.max(0.01, settings.fillInterval > 0 ? settings.fillInterval : 0.1);

  const allRows: FillScanlineRow[] = [];
  let rowIndex = 0;
  for (const angle of fillAngles) {
    const fillSettings: FillSettings = {
      interval,
      angle,
      biDirectional: settings.fillBiDirectional,
      overscanning: settings.overscanning,
    };
    const rows = generateFillRows(boundaryPaths, fillSettings, rowIndex);
    rowIndex += rows.length;
    for (let i = 0; i < rows.length; i++) {
      allRows.push(rows[i]);
    }
  }

  // Fallback: if no scanline rows but paths exist, trace outlines instead
  if (allRows.length === 0 && boundaryPaths.length > 0) {
    console.warn(
      `[LaserForge] Engrave fill produced no scanlines (interval ${interval.toFixed(3)}mm); ` +
        `falling back to outline trace (${boundaryPaths.length} path(s)). Check shape size vs line spacing.`,
    );
    let pos = startPos;
    const movesOut: Move[] = [];
    const ordered = orderPathsForCutting(boundaryPaths, pos, false);
    for (const { path, reversed } of ordered) {
      const pathMoves = planPath(path, reversed, settings);
      for (let i = 0; i < pathMoves.length; i++) {
        movesOut.push(pathMoves[i]);
      }
      pos = getPathEndpoint(path, reversed);
    }
    return movesOut;
  }

  if (allRows.length === 0) return [];

  const moves: Move[] = [];
  const power = settings.powerMax;
  const speed = settings.speed;
  const useFillAccel = settings.accelAwarePower !== false;
  const maxAccelFill = Math.max(1, settings.maxAccelMmPerS2);
  const minRatioFill = Math.max(0, Math.min(1, settings.minPowerRatioAccel));

  // Set M4 dynamic mode ONCE at the start with S0 (laser off).
  // Per GRBL spec, M4 inline S changes don't cause motion stops.
  moves.push({ type: 'laserOn', power: 0 });

  for (const row of allRows) {
    // 1. Rapid to the overscan start position (G0 — laser auto-off in M4 mode)
    moves.push({
      type: 'rapid',
      to: row.overscanFrom,
    });

    // 2. Overscan approach: G1 at speed with S0 (motion, laser off, machine accelerates)
    //    Skip if zero-length (overscanning = 0)
    if (row.segments.length > 0) {
      const approachTo = row.segments[0].actualFrom;
      const dx = approachTo.x - row.overscanFrom.x;
      const dy = approachTo.y - row.overscanFrom.y;
      if (dx * dx + dy * dy > 0.0001) {
        moves.push({
          type: 'linear',
          to: approachTo,
          power: 0,
          speed,
        });
      }
    }

    // 3. Burn segments with S0 gaps between them
    for (let i = 0; i < row.segments.length; i++) {
      const seg = row.segments[i];

      // Burn across this segment with velocity-scaled power (D.15)
      appendBurnMoves2D(
        moves,
        seg.actualFrom,
        seg.actualTo,
        power,
        speed,
        useFillAccel,
        maxAccelFill,
        minRatioFill,
      );

      // Gap to next segment: G1 with S0 (laser off, maintain speed)
      if (i < row.segments.length - 1) {
        const nextSeg = row.segments[i + 1];
        moves.push({
          type: 'linear',
          to: nextSeg.actualFrom,
          power: 0,
          speed,
        });
      }
    }

    // 4. Overscan exit: G1 at speed with S0 (motion, laser off, machine decelerates)
    //    Skip if zero-length (overscanning = 0)
    if (row.segments.length > 0) {
      const lastSeg = row.segments[row.segments.length - 1];
      const dx = row.overscanTo.x - lastSeg.actualTo.x;
      const dy = row.overscanTo.y - lastSeg.actualTo.y;
      if (dx * dx + dy * dy > 0.0001) {
        moves.push({
          type: 'linear',
          to: row.overscanTo,
          power: 0,
          speed,
        });
      }
    }
  }

  // Turn laser off at end of fill operation
  moves.push({ type: 'laserOff' });

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
  const useAccel = settings.accelAwarePower !== false;
  const maxAccel = Math.max(1, settings.maxAccelMmPerS2);
  const minRatio = Math.max(0, Math.min(1, settings.minPowerRatioAccel));

  const scanTable = settings.scanningOffsets;

  for (const scanline of scanlines) {
    for (const segment of scanline.segments) {
      let burnStartX = segment.startX;
      let burnEndX = segment.endX;
      if (scanTable.length > 0) {
        const off = interpolateOffset(scanTable, speed);
        const adj = applyScanOffset(segment.startX, segment.endX, off);
        burnStartX = adj.startX;
        burnEndX = adj.endX;
      }

      moves.push({
        type: 'rapid',
        to: { x: burnStartX, y: segment.y },
      });

      moves.push({
        type: 'laserOn',
        power: segment.power,
      });

      appendRasterBurnMoves(
        moves,
        burnStartX,
        burnEndX,
        segment.y,
        segment.power,
        speed,
        useAccel,
        maxAccel,
        minRatio,
      );

      moves.push({ type: 'laserOff' });
    }
  }

  return moves;
}

/**
 * 2D generalization of velocity-scaled burn segments: splits any burn line into
 * 2–3 G1 moves so power tracks velocity during acceleration/deceleration.
 * Used by vector fill engraves at arbitrary scan angles; rasters use
 * {@link appendRasterBurnMoves} (thin wrapper around this).
 */
export function appendBurnMoves2D(
  moves: Move[],
  from: Point,
  to: Point,
  powerPct: number,
  speed: number,
  useAccel: boolean,
  maxAccelMmPerS2: number,
  minPowerRatio: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lineLen = Math.hypot(dx, dy);

  let curX = from.x;
  let curY = from.y;

  const pushLinear = (px: number, py: number, pow: number): void => {
    if (Math.hypot(px - curX, py - curY) < 1e-4) return;
    moves.push({
      type: 'linear',
      to: { x: px, y: py },
      power: pow,
      speed,
    });
    curX = px;
    curY = py;
  };

  if (!useAccel || lineLen <= 0.5) {
    pushLinear(to.x, to.y, powerPct);
    return;
  }

  const tx = dx / lineLen;
  const ty = dy / lineLen;
  const pointAt = (distFromStart: number): Point => ({
    x: from.x + tx * distFromStart,
    y: from.y + ty * distFromStart,
  });

  const k: MoveKinematics = {
    distanceMm: lineLen,
    feedrateMmPerMin: speed,
    entryVelocityMmPerMin: 0,
    exitVelocityMmPerMin: 0,
    maxAccelMmPerS2: maxAccelMmPerS2,
  };
  const zones = computeVelocityZones(k);

  const goPt = (p: Point, pow: number): void => {
    pushLinear(p.x, p.y, pow);
  };

  const triangular =
    zones.isTriangular || zones.decelStartMm <= zones.accelEndMm + 1e-6;

  if (triangular) {
    const apexDist = zones.accelEndMm;
    const apexPt = pointAt(apexDist);
    const vMidA = velocityAt(apexDist / 2, k, zones);
    const s1 = scalePowerByVelocity(powerPct, vMidA, speed, minPowerRatio);
    goPt(apexPt, s1);

    const midD = (apexDist + lineLen) / 2;
    const vMidD = velocityAt(midD, k, zones);
    const s2 = scalePowerByVelocity(powerPct, vMidD, speed, minPowerRatio);
    goPt(to, s2);
    return;
  }

  const ptAccelEnd = pointAt(zones.accelEndMm);
  const ptDecelStart = pointAt(zones.decelStartMm);

  const vA = velocityAt(zones.accelEndMm / 2, k, zones);
  const sA = scalePowerByVelocity(powerPct, vA, speed, minPowerRatio);
  goPt(ptAccelEnd, sA);

  goPt(ptDecelStart, powerPct);

  const vD = velocityAt((zones.decelStartMm + lineLen) / 2, k, zones);
  const sD = scalePowerByVelocity(powerPct, vD, speed, minPowerRatio);
  goPt(to, sD);
}

/** Split a horizontal raster burn into 2–3 G1 moves with velocity-scaled power. */
function appendRasterBurnMoves(
  moves: Move[],
  startX: number,
  endX: number,
  y: number,
  powerPct: number,
  speed: number,
  useAccel: boolean,
  maxAccelMmPerS2: number,
  minPowerRatio: number,
): void {
  appendBurnMoves2D(
    moves,
    { x: startX, y },
    { x: endX, y },
    powerPct,
    speed,
    useAccel,
    maxAccelMmPerS2,
    minPowerRatio,
  );
}

// ─── PATH ORDERING (INSIDE-FIRST + NEAREST-NEIGHBOR) ─────────────

/**
 * Order paths for cutting with two constraints:
 * 1. Inner paths must be cut before outer paths (containment safety)
 * 2. Within each containment depth, minimize travel (2-opt order + best direction)
 *
 * When insideFirst is false, uses 2-opt ordering from the job start (no nesting).
 */
function orderPathsForCutting(
  paths: FlatPath[],
  startPos: Point,
  insideFirst: boolean
): OrderedPath[] {
  if (!insideFirst || paths.length <= 1) {
    return orderWithBestDirection(optimizePathOrder(paths, startPos), startPos);
  }

  // Separate closed and open paths
  const closed: FlatPath[] = [];
  const open: FlatPath[] = [];
  for (const p of paths) {
    (p.closed ? closed : open).push(p);
  }

  // If no closed paths, just nearest-neighbor the open ones
  if (closed.length === 0) {
    return orderWithBestDirection(optimizePathOrder(open, startPos), startPos);
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

    // Within this depth level, optimize order then pick traversal direction
    const ordered = orderWithBestDirection(optimizePathOrder(group, pos), pos);
    for (let i = 0; i < ordered.length; i++) {
      result.push(ordered[i]);
    }

    // Update position to end of last path in this group
    if (ordered.length > 0) {
      const last = ordered[ordered.length - 1];
      pos = getPathEndpoint(last.path, last.reversed);
    }
  }

  // Open paths go last, optimized order
  if (open.length > 0) {
    const orderedOpen = orderWithBestDirection(optimizePathOrder(open, pos), pos);
    for (let i = 0; i < orderedOpen.length; i++) {
      result.push(orderedOpen[i]);
    }
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
 * Fixed path order: choose start vs end traversal to minimize travel from current position.
 */
function orderWithBestDirection(paths: FlatPath[], startPos: Point): OrderedPath[] {
  if (paths.length === 0) return [];
  const result: OrderedPath[] = [];
  let pos = startPos;
  for (const path of paths) {
    const start = getPathStart(path);
    const end = getPathEnd(path);
    const dStart = distanceSq(pos, start);
    const dEnd = distanceSq(pos, end);
    const reversed = dEnd < dStart;
    result.push({ path, reversed });
    pos = getPathEndpoint(path, reversed);
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
