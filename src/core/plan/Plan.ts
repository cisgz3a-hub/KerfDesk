/**
 * === FILE: /src/core/plan/Plan.ts ===
 * 
 * Purpose:    The Plan is Stage 2 of the pipeline: Job → Plan.
 *             A Plan is an OPTIMIZED, ORDERED sequence of atomic
 *             machine moves. It knows exact distances, times, and
 *             move types. Still machine-agnostic — no G-code yet.
 * 
 *             The Move type is the most important abstraction in the
 *             entire system. Every laser job reduces to a sequence
 *             of Moves. Simulation reads Moves. Output generates
 *             from Moves. Preview renders Moves.
 * 
 * Pipeline:   Job → [optimizePlan()] → Plan → [generateOutput()] → Output
 * 
 * Dependencies: /src/core/types.ts
 * Last updated: Phase 5, Step 18 — Plan Optimizer (added laserOn/laserOff Move types)
 */

import { type Point, type AABB, generateId } from '../types';

// ─── MOVE TYPES (THE CORE ABSTRACTION) ───────────────────────────
/**
 * A Move is the atomic unit of machine motion.
 * The entire laser system reduces to sequences of these.
 * 
 * This is intentionally a discriminated union — each variant
 * carries only the data it needs. No optional fields.
 */
export type Move =
  | RapidMove
  | LinearMove
  | LaserOnMove
  | LaserOffMove
  | DwellMove
  | AirAssistMove
  | ZMove
  | MarkerMove;

export interface RapidMove {
  type: 'rapid';
  to: Point;
  // Laser is always OFF during rapid moves.
  // Speed is always machine max.
}

export interface LinearMove {
  type: 'linear';
  to: Point;
  power: number;    // 0–100%
  speed: number;    // mm/min
}

/**
 * Explicit laser state ON. Must appear before any linear cutting moves.
 * Maps to M4 S{power} in GRBL, M106 S{power} in Marlin.
 * Laser state is NOT embedded in linear moves — it is a separate command.
 */
export interface LaserOnMove {
  type: 'laserOn';
  power: number;    // 0–100%
}

/**
 * Explicit laser state OFF. Must appear after every path sequence.
 * Maps to M5 S0 in GRBL, M107 in Marlin.
 */
export interface LaserOffMove {
  type: 'laserOff';
}

export interface DwellMove {
  type: 'dwell';
  ms: number;       // Milliseconds to pause (for pierce delay)
}

export interface AirAssistMove {
  type: 'setAir';
  on: boolean;
}

export interface ZMove {
  type: 'setZ';
  z: number;        // mm (absolute Z position)
}

/**
 * Synthetic non-machine move. Emitted by the planner between FlatPaths
 * (vector) and before each raster/fill operation to mark which source
 * SceneObject(s) the following real moves belong to.
 *
 * Emitted by the output strategy as a gcode comment (; OBJ ids=...)
 * so the file stays human-readable. Parsed by GrblController during
 * sendJob to build a per-line source-object index for live UI state.
 *
 * Does NOT produce any real machine motion.
 */
export interface MarkerMove {
  type: 'marker';
  /**
   * SceneObject.id(s) whose burn starts here. Usually one element
   * (vector case); multiple for fill operations that interleave
   * scanlines across several objects.
   */
  sourceObjectIds: readonly string[];
}

// ─── PLANNED OPERATION ───────────────────────────────────────────

export interface PlannedOperation {
  operationId: string;       // Links back to Job.Operation.id
  layerName: string;         // For display / comments
  layerColor: string;
  passIndex: number;         // Which pass (0-based)
  /**
   * Eagerly materialized moves. Normal vector/fill/preview paths keep the
   * whole operation here. Large ticket-only raster plans may keep only a
   * small prefix here and replay row moves through `moveSource`.
   */
  moves: Move[];
  /** Lazily replayable suffix used for large raster start/device-send plans. */
  moveSource?: PlannedMoveSource;
  /** Eager moves that must execute after `moveSource` (for example air-off). */
  tailMoves?: Move[];
  /** Cached total move count including `moves`, `moveSource`, and `tailMoves`. */
  moveCount?: number;
}

export interface PlannedMoveSource {
  readonly kind: 'lazy-raster';
  readonly description: string;
  iterate(signal?: AbortSignal): Iterable<Move>;
}

export type PlannedOperationMoveContainer = Pick<
  PlannedOperation,
  'moves' | 'moveSource' | 'tailMoves' | 'moveCount'
>;

// ─── PLAN STATISTICS ─────────────────────────────────────────────

export interface PlanStats {
  totalDistanceMm: number;
  rapidDistanceMm: number;
  cutDistanceMm: number;
  estimatedTimeSeconds: number;
  moveCount: number;
  operationCount: number;
  passCount: number;
}

// ─── PLAN ────────────────────────────────────────────────────────

export interface Plan {
  readonly id: string;
  jobId: string;
  createdAt: string;

  operations: PlannedOperation[];
  stats: PlanStats;
  bounds: AABB;
}

// ─── FACTORY ─────────────────────────────────────────────────────

export function createEmptyPlan(jobId: string): Plan {
  return {
    id: generateId(),
    jobId,
    createdAt: new Date().toISOString(),
    operations: [],
    stats: emptyStats(),
    bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  };
}

export function emptyStats(): PlanStats {
  return {
    totalDistanceMm: 0,
    rapidDistanceMm: 0,
    cutDistanceMm: 0,
    estimatedTimeSeconds: 0,
    moveCount: 0,
    operationCount: 0,
    passCount: 0,
  };
}

// ─── PLAN ANALYSIS ───────────────────────────────────────────────

/**
 * T1-166 (audit F-030): time-estimation defaults for
 * {@link calculatePlanStats} when the caller doesn't override.
 *
 * Why 500 mm/s² (not 1000)? `DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2 = 1000`
 * (in `jobCompilerHelpers.ts`) is the planner's typical-small-laser
 * default for the raster-power velocity-curve math — it has to match
 * what the firmware will actually do on a representative diode laser.
 * Here the value is used only for trapezoidal time estimation; a
 * lower value overestimates time slightly (the machine, if more
 * capable, finishes earlier than predicted) which is the correct
 * direction for a "this is how long the burn will take" estimate.
 * Pre-T1-166 these were inline magic numbers at three call sites,
 * making the rationale invisible and risking accidental drift.
 */
export const DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2 = 500;
export const DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN = 6000;

/**
 * Calculates plan statistics by iterating all moves.
 * Uses trapezoidal velocity model for accurate time estimation.
 */
export function calculatePlanStats(
  plan: Plan,
  maxAcceleration: number = DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2,  // mm/s² (default for diode lasers)
  maxRapidSpeed: number = DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN,   // mm/min
): PlanStats {
  let totalDist = 0;
  let rapidDist = 0;
  let cutDist = 0;
  let totalTime = 0;
  let moveCount = 0;
  let prevPos: Point = { x: 0, y: 0 };

  for (const op of plan.operations) {
    let operationMoveCount = 0;
    for (const move of iteratePlannedOperationMoves(op)) {
      moveCount++;
      operationMoveCount++;

      switch (move.type) {
        case 'rapid': {
          const d = distance(prevPos, move.to);
          rapidDist += d;
          totalDist += d;
          totalTime += estimateMoveTime(d, maxRapidSpeed, maxAcceleration);
          prevPos = move.to;
          break;
        }
        case 'linear': {
          const d = distance(prevPos, move.to);
          cutDist += d;
          totalDist += d;
          totalTime += estimateMoveTime(d, move.speed, maxAcceleration);
          prevPos = move.to;
          break;
        }
        case 'dwell': {
          totalTime += move.ms / 1000;
          break;
        }
        case 'marker':
          break;
        // setAir, setZ, laserOn, laserOff, marker don't contribute to distance or time
      }
    }
    op.moveCount = operationMoveCount;
  }

  return {
    totalDistanceMm: totalDist,
    rapidDistanceMm: rapidDist,
    cutDistanceMm: cutDist,
    estimatedTimeSeconds: totalTime,
    moveCount,
    operationCount: plan.operations.length,
    passCount: plan.operations.reduce((max, op) => Math.max(max, op.passIndex + 1), 0),
  };
}

// ─── TRAPEZOIDAL VELOCITY MODEL ──────────────────────────────────
/**
 * Estimates time for a single move accounting for acceleration.
 * Uses trapezoidal profile: accel → cruise → decel.
 * Falls back to triangle profile for short moves.
 */
function estimateMoveTime(
  distanceMm: number,
  requestedSpeedMmMin: number,
  accelerationMmS2: number
): number {
  if (distanceMm <= 0) return 0;

  const v = requestedSpeedMmMin / 60;      // Convert to mm/s
  const a = accelerationMmS2;
  const accelDist = (v * v) / (2 * a);     // Distance to reach full speed

  if (2 * accelDist >= distanceMm) {
    // Triangle profile — never reaches full speed
    return 2 * Math.sqrt(distanceMm / a);
  } else {
    // Trapezoidal profile
    const accelTime = v / a;
    const cruiseDist = distanceMm - 2 * accelDist;
    const cruiseTime = cruiseDist / v;
    return 2 * accelTime + cruiseTime;
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────

function distance(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// ─── ITERATION HELPERS ───────────────────────────────────────────

/**
 * Iterate all moves in a plan in execution order.
 * Yields [operationIndex, moveIndex, move] tuples.
 */
export function* iterateMoves(
  plan: Plan
): Generator<[number, number, Move]> {
  for (let oi = 0; oi < plan.operations.length; oi++) {
    const op = plan.operations[oi];
    let mi = 0;
    for (const move of iteratePlannedOperationMoves(op)) {
      yield [oi, mi, move];
      mi++;
    }
  }
}

/**
 * Count total moves across all operations.
 */
export function totalMoveCount(plan: Plan): number {
  return plan.operations.reduce((sum, op) => sum + countPlannedOperationMoves(op), 0);
}

export function* iteratePlannedOperationMoves(
  operation: PlannedOperationMoveContainer,
  signal?: AbortSignal,
): Generator<Move, void, void> {
  for (const move of operation.moves) {
    if (signal?.aborted) return;
    yield move;
  }
  if (operation.moveSource) {
    for (const move of operation.moveSource.iterate(signal)) {
      if (signal?.aborted) return;
      yield move;
    }
  }
  if (operation.tailMoves) {
    for (const move of operation.tailMoves) {
      if (signal?.aborted) return;
      yield move;
    }
  }
}

export function countPlannedOperationMoves(
  operation: PlannedOperationMoveContainer,
  signal?: AbortSignal,
): number {
  if (operation.moveCount != null) return operation.moveCount;
  let count = 0;
  for (const _move of iteratePlannedOperationMoves(operation, signal)) {
    count++;
  }
  operation.moveCount = count;
  return count;
}
