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
  | ZMove;

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

// ─── PLANNED OPERATION ───────────────────────────────────────────

export interface PlannedOperation {
  operationId: string;       // Links back to Job.Operation.id
  layerName: string;         // For display / comments
  layerColor: string;
  passIndex: number;         // Which pass (0-based)
  moves: Move[];
}

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
 * Calculates plan statistics by iterating all moves.
 * Uses trapezoidal velocity model for accurate time estimation.
 */
export function calculatePlanStats(
  plan: Plan,
  maxAcceleration: number = 500,  // mm/s² (default for diode lasers)
  maxRapidSpeed: number = 6000,   // mm/min
): PlanStats {
  let totalDist = 0;
  let rapidDist = 0;
  let cutDist = 0;
  let totalTime = 0;
  let moveCount = 0;
  let prevPos: Point = { x: 0, y: 0 };

  for (const op of plan.operations) {
    for (const move of op.moves) {
      moveCount++;

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
        // setAir, setZ, laserOn, laserOff don't contribute to distance or time
      }
    }
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
    for (let mi = 0; mi < op.moves.length; mi++) {
      yield [oi, mi, op.moves[mi]];
    }
  }
}

/**
 * Count total moves across all operations.
 */
export function totalMoveCount(plan: Plan): number {
  return plan.operations.reduce((sum, op) => sum + op.moves.length, 0);
}
