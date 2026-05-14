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

import { type Point } from '../types';
import {
  type Job, type Operation, type FlatPath,
  type ResolvedLaserSettings,
} from '../job/Job';
import { type CompoundPath } from '../geometry/CompoundPath';
import {
  type Plan, type PlannedOperation, type Move,
  createEmptyPlan, calculatePlanStats,
  // T1-166 (audit F-030): named-constant fallbacks for the
  // calculatePlanStats time-estimation parameters. Pre-T1-166 these
  // were inline `?? 500` / `?? 6000` magic numbers.
  DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2,
  DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN,
} from './Plan';
import {
  applyInsideFirstOrder,
  buildContainmentTree,
  type ContainmentNode,
} from './ContainmentOrder';
import {
  generateFillRows,
  generateFillRowsForCompoundPaths,
  type FillSettings,
  type FillScanlineRow,
} from './FillGenerator';
import {
  iterateRasterScanlines,
  type RasterSettings,
} from './RasterGenerator';
import { optimizePathOrder } from './PathOptimizer';
import {
  computeVelocityZones,
  velocityAt,
  scalePowerByVelocity,
  type MoveKinematics,
} from './VelocityProfile';
import { interpolateOffset, applyScanOffset } from './ScanningOffset';
// T1-149: pure coordinate / direction-choice / position-tracking /
// plan-bounds / distance helpers extracted so each can be tested
// without loading the full PlanOptimizer import surface.
import {
  computePlanBounds,
  distanceSq,
  getFinalPosition,
  getFinalPositionFromMoves,
  getLastOrderedPathEndpoint,
  getPathEnd,
  getPathEndpoint,
  getPathStart,
  orderWithBestDirection,
  type OrderedPath,
} from './planOptimizerHelpers';

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * T1-177 (external audit High #7): thrown when an engrave-fill
 * operation produces zero scanline rows but the boundary paths are
 * non-empty. Pre-T1-177 this case silently fell back to outline
 * tracing, mutating the manufacturing intent (engrave → cut). The
 * audit flagged this as a High-severity safety / UX defect: the user
 * receives no feedback before the material is committed.
 *
 * `diagnostics` carries everything the UI / support log needs to
 * explain the failure without re-running the planner:
 *   - `interval`: the resolved fill spacing (mm) — usually too large
 *     relative to the shape.
 *   - `fillMode`: `'line'` or `'cross-hatch'`.
 *   - `fillAngles`: the angles the planner tried (one for line, two
 *     for cross-hatch).
 *   - `boundaryPathCount`: how many boundary paths were skipped.
 *
 * Remediation: reduce `fillInterval` (e.g. 0.5mm → 0.1mm) or
 * increase the shape size so a scanline of the requested angle
 * actually crosses the geometry.
 */
export interface FillProducedNoRowsDiagnostics {
  /**
   * Same string union as `Layer.FillMode`. Re-declared inline to keep
   * the error class importable without pulling the scene-layer type
   * graph — `Plan.ts` is the boundary between job/plan and scene.
   */
  readonly fillMode: 'line' | 'offset' | 'cross-hatch';
  readonly interval: number;
  readonly fillAngles: readonly number[];
  readonly boundaryPathCount: number;
}

export class FillProducedNoRowsError extends Error {
  readonly diagnostics: FillProducedNoRowsDiagnostics;
  constructor(diagnostics: FillProducedNoRowsDiagnostics) {
    const angleSummary = diagnostics.fillAngles
      .map(a => `${a.toFixed(1)}°`)
      .join(', ');
    super(
      `Engrave fill produced no scanlines (mode=${diagnostics.fillMode}, `
      + `interval=${diagnostics.interval.toFixed(3)}mm, angles=[${angleSummary}], `
      + `${diagnostics.boundaryPathCount} boundary path(s)). `
      + 'Reduce the fill interval or increase the shape size so a scanline crosses '
      + 'the geometry. Outline-trace fallback was removed in T1-177 because it '
      + 'silently mutated engrave-fill intent into a cut operation.',
    );
    this.name = 'FillProducedNoRowsError';
    this.diagnostics = diagnostics;
  }
}

export interface OptimizePlanConfig {
  /**
   * Max rapid travel speed in mm/min (default
   * {@link DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN}). T1-166 (audit
   * F-030): named constant — see Plan.ts for the rationale.
   */
  maxRapidSpeed?: number;
  /**
   * Max acceleration in mm/s² (default
   * {@link DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2}). T1-166 (audit
   * F-030): named constant — see Plan.ts for the rationale.
   */
  maxAcceleration?: number;
  /** T2-17-followup: cooperative cancellation for long operation-planning loops. */
  signal?: AbortSignal;
  /** T2-17-followup: progress through the operation-planning loop. */
  onProgress?: (event: OptimizePlanProgress) => void;
}

export interface OptimizePlanProgress {
  readonly phase: 'operation';
  readonly operationIndex: number;
  readonly operationCount: number;
  readonly fraction: number;
  readonly detail?: string;
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

  const operationCount = job.operations.length;
  reportOptimizeProgress(config, 0, operationCount);
  throwIfOptimizeAborted(config?.signal);

  for (let operationIndex = 0; operationIndex < operationCount; operationIndex++) {
    const operation = job.operations[operationIndex];
    // T1-165 (audit F-029): thread the signal into planOperation so
    // inner scanline / fill / path loops can check cooperatively.
    // Pre-T1-165 throwIfOptimizeAborted ran only between operations,
    // so a 12MP raster (millions of moves in one operation) had to
    // finish before cancel could land — 5–30 s of unresponsive UI
    // after the cancel click.
    const planned = planOperation(operation, currentPos, config?.signal);
    if (planned.length === 0) continue;

    for (let i = 0; i < planned.length; i++) {
      plan.operations.push(planned[i]);
    }

    // Track laser head position across operations
    currentPos = getFinalPosition(planned);
    reportOptimizeProgress(config, operationIndex + 1, operationCount, operation.id);
    throwIfOptimizeAborted(config?.signal);
  }

  // Compute bounds from all moves
  plan.bounds = computePlanBounds(plan);

  plan.stats = calculatePlanStats(
    plan,
    config?.maxAcceleration ?? DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2,
    config?.maxRapidSpeed ?? DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN,
  );

  return plan;
}

function throwIfOptimizeAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Compile cancelled', 'AbortError');
  }
}

function reportOptimizeProgress(
  config: OptimizePlanConfig | undefined,
  operationIndex: number,
  operationCount: number,
  detail?: string,
): void {
  if (!config?.onProgress) return;
  const fraction = operationCount === 0 ? 1 : operationIndex / operationCount;
  config.onProgress({
    phase: 'operation',
    operationIndex,
    operationCount,
    fraction,
    detail,
  });
}

// ─── OPERATION PLANNING ──────────────────────────────────────────

/**
 * Plan a single Operation into one or more PlannedOperations.
 * Multiple PlannedOperations are produced for multi-pass jobs.
 */
function planOperation(
  operation: Operation,
  startPos: Point,
  signal?: AbortSignal,
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
      moves.push({
        type: 'marker',
        sourceObjectIds: [operation.geometry.bitmap.sourceObjectId],
      });
      // RASTER: Convert bitmap pixels to scanline moves
      const rasterMoves = planRasterOperation(
        operation.geometry.bitmap,
        settings,
        pos,
        signal,
      );
      for (let i = 0; i < rasterMoves.length; i++) {
        moves.push(rasterMoves[i]);
      }
    } else if (operation.type === 'engrave' && operation.geometry.type === 'fill') {
      const fillIds = Array.from(new Set(operation.geometry.paths.map(p => p.id)));
      if (fillIds.length > 0) {
        moves.push({ type: 'marker', sourceObjectIds: fillIds });
      }
      // FILL: engrave only — never infer from fillInterval on cut/score jobs
      const fillMoves = planFillOperation(
        operation.geometry.paths,
        settings,
        pos,
        operation.geometry.compoundPaths,
        signal,
      );
      for (let i = 0; i < fillMoves.length; i++) {
        moves.push(fillMoves[i]);
      }
    } else {
      // VECTOR (cut/score): Outline paths with inside-first ordering
      const paths = operation.geometry.paths;
      if (paths.length > 0) {
        const ordered = orderPathsForCutting(
          paths,
          pos,
          settings.insideFirst,
          operation.type === 'cut',
        );
        for (const { path, reversed } of ordered) {
          // T1-165: check between paths so cancel lands within ~1 path
          // of click even when the operation contains thousands of paths.
          throwIfOptimizeAborted(signal);
          moves.push({ type: 'marker', sourceObjectIds: [path.id] });
          const pathMoves = planPath(path, reversed, settings, signal);
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
  settings: ResolvedLaserSettings,
  signal?: AbortSignal,
): Move[] {
  // T1-165: a single path is usually small (10–10k points) but bezier-
  // tessellated curves can hit 100k+. Check at entry so a cancel before
  // we begin still aborts; the inner segment loop is tight enough that
  // a single per-path check is the right granularity.
  throwIfOptimizeAborted(signal);
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
          // T1-179 (external audit High #7): tab traversal uses G1
          // (linear feed) with the laser off, NOT G0 (rapid). Pre-
          // T1-179 this emitted a `rapid` move type, which encodes
          // as `G0 X.. Y..`. The audit flagged this as High severity:
          // rapid motion across a tab gap while the head is
          // mechanically engaged at cutting height can jerk, lose
          // steps, or produce inaccurate restart points (the planner
          // assumes the next burn point exists at the post-tab
          // location, but a step-loss event shifts that location).
          // Using G1 at the cut feed rate keeps motion kinematically
          // consistent with the surrounding burn — same acceleration
          // envelope, same feed budget, no rapid-vs-cut jerk.
          moves.push({ type: 'linear', to: { x: px, y: py }, power: 0, speed });
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
  startPos: Point,
  compoundPaths?: readonly CompoundPath[],
  signal?: AbortSignal,
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
    const rows = compoundPaths && compoundPaths.length > 0
      ? generateFillRowsForCompoundPaths(compoundPaths, fillSettings, rowIndex)
      : generateFillRows(boundaryPaths, fillSettings, rowIndex);
    rowIndex += rows.length;
    for (let i = 0; i < rows.length; i++) {
      allRows.push(rows[i]);
    }
  }

  // T1-177 (external audit High #7): refuse to silently fall back
  // to outline tracing when a fill produces zero scanlines.
  //
  // Pre-T1-177 this branch traced the boundary paths as a CUT
  // operation when the fill interval / geometry combination produced
  // no rows. A user who chose "engrave fill" got an outline cut
  // instead — a different manufacturing operation with different
  // material outcome (the laser cuts THROUGH the boundary on a
  // shape that was meant to receive surface engraving). The audit
  // flagged this as High severity: manufacturing intent is silently
  // mutated, the user receives no feedback before commit, and the
  // material may be ruined.
  //
  // Post-T1-177: throw `FillProducedNoRowsError` carrying enough
  // diagnostic info for the UI / support log to explain the failure.
  // The user must adjust the fill interval (typically reduce it) or
  // resize the shape to fit the interval before the job can compile.
  if (allRows.length === 0 && boundaryPaths.length > 0) {
    throw new FillProducedNoRowsError({
      fillMode,
      interval,
      fillAngles,
      boundaryPathCount: boundaryPaths.length,
    });
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
    // T1-165 (audit F-029): cancel-aware per-row check. Large fills
    // can produce 10k+ rows × 100s of segments — checking once per
    // row bounds cancel latency at one row of planning work (~ms),
    // not the whole operation.
    throwIfOptimizeAborted(signal);
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
 * T1-31: Modal-M4 raster strategy. ONE `laserOn` at the start of the
 * operation and ONE `laserOff` at the end — not per segment. Between
 * scanlines a `rapid` (G0) moves to the next row's start; in M4
 * dynamic-power mode the laser auto-extinguishes during G0 motion.
 * Within a scanline, multiple burn segments are stitched with
 * power=0 linear moves bridging the gaps. Each burn segment still
 * runs through `appendRasterBurnMoves` for velocity-aware power
 * splits during accel/decel.
 *
 * Pre-T1-31 each segment was wrapped in its own M4/M5 pair —
 * thousands of modal cycles per pass for a photo engrave, causing
 * planner stutter, fat/weak segment boundaries, and saturated buffer
 * bandwidth. The fill strategy (`planFillOperation`) already used
 * the modal pattern; this brings raster to parity.
 */
function planRasterOperation(
  bitmap: import('../job/Job').ProcessedBitmap,
  settings: ResolvedLaserSettings,
  startPos: Point,
  signal?: AbortSignal,
): Move[] {
  const rasterSettings: RasterSettings = {
    powerMin: settings.powerMin,
    powerMax: settings.powerMax,
    speed: settings.speed,
    biDirectional: settings.fillBiDirectional,
    overscanning: settings.overscanning,
    grayscalePowerMergeTolerance: settings.grayscalePowerMergeTolerance,
    responseCurve: settings.responseCurve,
  };

  const moves: Move[] = [];
  const speed = settings.speed;
  const useAccel = settings.accelAwarePower !== false;
  const maxAccel = Math.max(1, settings.maxAccelMmPerS2);
  const minRatio = Math.max(0, Math.min(1, settings.minPowerRatioAccel));

  const scanTable = settings.scanningOffsets;

  // T1-31: single M4 covers the whole raster operation. M4 dynamic
  // power mode means the laser auto-cuts during G0 between scanlines
  // and follows S inline during G1.
  moves.push({ type: 'laserOn', power: 0 });

  let sawScanline = false;
  for (const scanline of iterateRasterScanlines(bitmap, rasterSettings)) {
    if (scanline.segments.length === 0) continue;
    sawScanline = true;
    // T1-165 (audit F-029): cancel-aware per-scanline check. A 12MP
    // photo produces ~4000 scanlines × 100–1000 segments — the inner
    // segment loop here is ~0.1–1ms per scanline, so checking once
    // per scanline lands a cancel within ~ms instead of waiting
    // 5–30s for the whole raster operation to finish.
    throwIfOptimizeAborted(signal);

    // Apply per-speed scanning offset to every segment in this row up
    // front so the gap-bridge logic below uses the adjusted endpoints
    // (not the raw segment.startX/endX which may not align after offset).
    const adjusted: Array<{ startX: number; endX: number; power: number; y: number }> = [];
    for (const seg of scanline.segments) {
      let s = seg.startX;
      let e = seg.endX;
      if (scanTable.length > 0) {
        const off = interpolateOffset(scanTable, speed);
        const a = applyScanOffset(seg.startX, seg.endX, off);
        s = a.startX;
        e = a.endX;
      }
      adjusted.push({ startX: s, endX: e, power: seg.power, y: seg.y });
    }

    // T1-173 (audit Critical #1): rapid to the row's overscan-from,
    // NOT the first segment's burn-start. The overscan-from is the
    // entry point for the row's travel envelope; the laser is off
    // here. Pre-T1-173 the rapid landed at `firstSeg.startX` which
    // had `-overscan` baked in, but `appendRasterBurnMoves` then
    // burned from that point at full power — engraving outside the
    // artwork.
    moves.push({ type: 'rapid', to: { x: scanline.overscanFromX, y: adjusted[0].y } });

    // T1-173: G1 S0 approach from overscan-from to the first burn
    // pixel. The machine accelerates to scan speed during this
    // distance with the laser off, so the first burn pixel is hit
    // at the correct velocity. Skip if overscan === 0 (no headroom).
    const firstBurnStart = adjusted[0].startX;
    if (Math.abs(firstBurnStart - scanline.overscanFromX) > 1e-4) {
      moves.push({
        type: 'linear',
        to: { x: firstBurnStart, y: adjusted[0].y },
        power: 0,
        speed,
      });
    }

    let prevEndX = firstBurnStart;
    for (let i = 0; i < adjusted.length; i++) {
      const seg = adjusted[i];
      // Bridge the gap from the previous segment's end to this
      // segment's start with a power=0 linear move. Same direction
      // as the burn (LTR or RTL); the sign of the X-delta carries
      // direction. Skipped on the first iteration (prevEndX ===
      // first segment's startX) and skipped when two segments abut.
      if (i > 0 && Math.abs(seg.startX - prevEndX) > 1e-4) {
        moves.push({
          type: 'linear',
          to: { x: seg.startX, y: seg.y },
          power: 0,
          speed,
        });
      }

      appendRasterBurnMoves(
        moves,
        seg.startX,
        seg.endX,
        seg.y,
        seg.power,
        speed,
        useAccel,
        maxAccel,
        minRatio,
      );
      prevEndX = seg.endX;
    }

    // T1-173: G1 S0 exit from the last burn-end to overscan-to.
    // The machine decelerates with the laser off so deceleration
    // doesn't degrade the trailing burn pixels. Skip when overscan
    // === 0.
    if (Math.abs(scanline.overscanToX - prevEndX) > 1e-4) {
      moves.push({
        type: 'linear',
        to: { x: scanline.overscanToX, y: adjusted[adjusted.length - 1].y },
        power: 0,
        speed,
      });
    }
  }

  if (!sawScanline) return [];

  moves.push({ type: 'laserOff' });

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
 * Order vector paths with three constraints:
 * 1. Optional open-before-closed ordering for cut operations (score-like cuts before part release)
 * 2. Inner closed paths must be cut before outer paths when insideFirst is enabled
 * 3. Within each partition/depth, minimize travel (2-opt order + best direction)
 *
 * When insideFirst is false, uses 2-opt ordering from the job start (no nesting).
 */
function orderPathsForCutting(
  paths: FlatPath[],
  startPos: Point,
  insideFirst: boolean,
  openBeforeClosed: boolean = false,
): OrderedPath[] {
  if ((!insideFirst && !openBeforeClosed) || paths.length <= 1) {
    return orderWithBestDirection(optimizePathOrder(paths, startPos), startPos);
  }

  // Separate closed and open paths
  const closed: FlatPath[] = [];
  const open: FlatPath[] = [];
  for (const p of paths) {
    (p.closed ? closed : open).push(p);
  }

  const result: OrderedPath[] = [];
  let pos = startPos;

  if (openBeforeClosed && open.length > 0) {
    const orderedOpen = orderWithBestDirection(optimizePathOrder(open, pos), pos);
    for (let i = 0; i < orderedOpen.length; i++) {
      result.push(orderedOpen[i]);
    }
    pos = getLastOrderedPathEndpoint(orderedOpen, pos);
  }

  if (closed.length > 0) {
    if (insideFirst) {
      // Build containment tree and get depth-grouped paths
      const depthGroups = getDepthGroups(closed);

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
        pos = getLastOrderedPathEndpoint(ordered, pos);
      }
    } else {
      const orderedClosed = orderWithBestDirection(optimizePathOrder(closed, pos), pos);
      for (let i = 0; i < orderedClosed.length; i++) {
        result.push(orderedClosed[i]);
      }
      pos = getLastOrderedPathEndpoint(orderedClosed, pos);
    }
  }

  if (!openBeforeClosed && open.length > 0) {
    const orderedOpen = orderWithBestDirection(optimizePathOrder(open, pos), pos);
    for (let i = 0; i < orderedOpen.length; i++) {
      result.push(orderedOpen[i]);
    }
  }

  return result;
}

// T1-149: getLastOrderedPathEndpoint moved to ./planOptimizerHelpers.

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

// T1-149: orderWithBestDirection / getPathStart / getPathEnd /
// getPathEndpoint / getFinalPosition / getFinalPositionFromMoves /
// computePlanBounds / distanceSq moved to ./planOptimizerHelpers.
