/**
 * T1-188 (external audit High #2 + #8): divergence check between the
 * Plan-derived burn envelope and the emitted-gcode burn envelope.
 *
 * T1-182 shipped the emitted-gcode parser; T1-188 wires it into a
 * compile-time consistency check that surfaces divergence as a
 * structured warning attached to the compile result. The audit's
 * framing was "the user may approve a preview that is not the actual
 * program." The plan-based simulation today drives the preview; if
 * the emitted gcode's burn region differs (e.g. footer return motion
 * emitted at non-zero power, a pre-T1-180 zero-distance dwell burn,
 * a pre-T1-173 raster overscan baked into segment endpoints), the
 * user approved one job and is about to run another. The divergence
 * check catches that at compile time, before the ticket is presented
 * for approval.
 *
 * The check is intentionally non-blocking (a `WarningKind` enum, not
 * a thrown error) so legitimate small differences (machine-transform
 * float rounding, programmed Z-only moves the parser ignores) don't
 * block legitimate jobs. The structured warning surfaces in the
 * compile-result and the next ticket-shaping step decides what to do
 * with it (a future ticket may convert specific warnings to blockers).
 *
 * The tolerance is intentionally generous (0.5 mm on each AABB edge)
 * so it catches gross divergence (raster overscan was 3 mm × 4 sides;
 * dwell burns extend 0 mm but show up as zero-burnMoveCount mismatch)
 * without flagging legitimate floating-point noise. Anything tighter
 * would require characterizing the float-rounding budget of every
 * upstream transform — out of scope.
 */
import type { AABB } from '../types';
import { iteratePlannedOperationMoves, type Plan } from '../plan/Plan';
import { analyzeEmittedBurnEnvelope, type EmittedBurnEnvelope } from './emittedBurnEnvelope';

export const BURN_ENVELOPE_DIVERGENCE_TOLERANCE_MM = 0.5;

export type BurnEnvelopeDivergenceKind =
  /** Plan emits burn moves but the parser found none in the gcode. */
  | 'emitted-empty-plan-non-empty'
  /** Parser found burns but the plan emits none. */
  | 'plan-empty-emitted-non-empty'
  /** Both non-empty but the AABB edges disagree by more than `TOLERANCE_MM`. */
  | 'envelope-edge-mismatch';

export interface BurnEnvelopeDivergenceReport {
  readonly kind: BurnEnvelopeDivergenceKind;
  readonly planBurnBounds: AABB | null;
  readonly emittedBurnBounds: AABB | null;
  readonly maxEdgeDeltaMm: number;
  readonly planBurnMoveCount: number;
  readonly emittedBurnMoveCount: number;
  readonly toleranceMm: number;
}

/**
 * Walk a Plan's operations and compute the AABB of all laser-on
 * linear moves. Both endpoints of each segment contribute (so the
 * AABB matches the emitter's expansion algorithm).
 *
 * The previous-position tracker carries forward across segments;
 * rapids update the position but don't expand the burn AABB. Arc
 * Plan moves don't exist in the current Plan IR (linear-only), but
 * if a future Move variant adds them the parser-side arc bounds
 * will need a sibling here.
 */
export function computePlanBurnEnvelope(plan: Plan): {
  burnBounds: AABB | null;
  burnMoveCount: number;
} {
  const env = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let burnMoveCount = 0;
  let prevX = 0;
  let prevY = 0;
  for (const op of plan.operations) {
    for (const move of iteratePlannedOperationMoves(op)) {
      if (move.type === 'rapid') {
        prevX = move.to.x;
        prevY = move.to.y;
      } else if (move.type === 'linear') {
        if (move.power > 0) {
          if (env.minX > prevX) env.minX = prevX;
          if (env.maxX < prevX) env.maxX = prevX;
          if (env.minY > prevY) env.minY = prevY;
          if (env.maxY < prevY) env.maxY = prevY;
          if (env.minX > move.to.x) env.minX = move.to.x;
          if (env.maxX < move.to.x) env.maxX = move.to.x;
          if (env.minY > move.to.y) env.minY = move.to.y;
          if (env.maxY < move.to.y) env.maxY = move.to.y;
          burnMoveCount++;
        }
        prevX = move.to.x;
        prevY = move.to.y;
      }
    }
  }
  if (burnMoveCount === 0) return { burnBounds: null, burnMoveCount: 0 };
  return {
    burnBounds: { minX: env.minX, minY: env.minY, maxX: env.maxX, maxY: env.maxY },
    burnMoveCount,
  };
}

/**
 * Compare the plan's burn envelope to the emitted gcode's burn
 * envelope. Returns `null` when they agree within tolerance.
 * Returns a structured `BurnEnvelopeDivergenceReport` otherwise.
 *
 * Tolerance applies per-AABB-edge (4 edges × max delta). The
 * `maxEdgeDeltaMm` field carries the worst observed difference for
 * support-bundle diagnosis.
 */
export function checkBurnEnvelopeDivergence(
  plan: Plan,
  gcode: string,
  toleranceMm: number = BURN_ENVELOPE_DIVERGENCE_TOLERANCE_MM,
): BurnEnvelopeDivergenceReport | null {
  return checkBurnEnvelopeDivergenceFromEnvelope(
    plan,
    analyzeEmittedBurnEnvelope(gcode),
    toleranceMm,
  );
}

export function checkBurnEnvelopeDivergenceFromEnvelope(
  plan: Plan,
  emitted: EmittedBurnEnvelope,
  toleranceMm: number = BURN_ENVELOPE_DIVERGENCE_TOLERANCE_MM,
): BurnEnvelopeDivergenceReport | null {
  const planEnv = computePlanBurnEnvelope(plan);
  // Case 1: plan emits burns, gcode parser finds none.
  if (planEnv.burnBounds !== null && emitted.burnBounds === null) {
    return {
      kind: 'emitted-empty-plan-non-empty',
      planBurnBounds: planEnv.burnBounds,
      emittedBurnBounds: null,
      maxEdgeDeltaMm: Infinity,
      planBurnMoveCount: planEnv.burnMoveCount,
      emittedBurnMoveCount: emitted.burnMoveCount,
      toleranceMm,
    };
  }
  // Case 2: parser finds burns, plan emits none.
  if (planEnv.burnBounds === null && emitted.burnBounds !== null) {
    return {
      kind: 'plan-empty-emitted-non-empty',
      planBurnBounds: null,
      emittedBurnBounds: emitted.burnBounds,
      maxEdgeDeltaMm: Infinity,
      planBurnMoveCount: 0,
      emittedBurnMoveCount: emitted.burnMoveCount,
      toleranceMm,
    };
  }
  // Case 3: both empty — they agree.
  if (planEnv.burnBounds === null && emitted.burnBounds === null) {
    return null;
  }
  // Case 4: both non-empty — compare per-edge.
  const a = planEnv.burnBounds!;
  const e = emitted.burnBounds!;
  const dMinX = Math.abs(a.minX - e.minX);
  const dMaxX = Math.abs(a.maxX - e.maxX);
  const dMinY = Math.abs(a.minY - e.minY);
  const dMaxY = Math.abs(a.maxY - e.maxY);
  const maxEdgeDeltaMm = Math.max(dMinX, dMaxX, dMinY, dMaxY);
  if (maxEdgeDeltaMm <= toleranceMm) {
    return null;
  }
  return {
    kind: 'envelope-edge-mismatch',
    planBurnBounds: a,
    emittedBurnBounds: e,
    maxEdgeDeltaMm,
    planBurnMoveCount: planEnv.burnMoveCount,
    emittedBurnMoveCount: emitted.burnMoveCount,
    toleranceMm,
  };
}
