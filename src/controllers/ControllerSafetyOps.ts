/**
 * T2-42: `ControllerSafetyOps` as a separate contract. Pre-T2-42
 * the safety methods at `src/controllers/ControllerInterface.ts:
 * 99-103` (pause/resume/stop/emergencyStop) lived directly on the
 * main `LaserController` interface, mixed with transport,
 * lifecycle, and command-streaming methods. T2-26 already plans
 * `MachineOperationApi` for jog/home/etc.; T2-42 splits the
 * safety-specific subset into its own interface so:
 *
 *   - capability detection can ask "does this controller declare
 *     safety semantics?" before allowing risky operations
 *   - the main `LaserController` interface stays minimal (transport,
 *     state, lifecycle)
 *   - different controllers can refuse unsupported safety
 *     primitives cleanly via `accepted: false` rather than throwing
 *     or doing nothing
 *
 * Audit 3D Required P0 "controller-specific safety contract" +
 * section 4.1 (different methods for distinct safety classes).
 *
 * T2-42 ships the interface + helper builders for unsupported and
 * not-connected refusals. Wiring `GrblController` to expose
 * `safetyOps` and migrating MachineService / ExecutionCoordinator
 * call sites is filed as T2-42-followup since each callsite is a
 * heightened-bar (safety code path) review per CLAUDE.md.
 */

import type {
  SafetyActionResult,
  SafetyAction,
} from './SafetyActionResult';

export type SafetyUrgency = 'normal' | 'urgent' | 'emergency';

/** Minimum subset of test-fire arguments needed for the safety contract. */
export interface TestFireRequest {
  readonly powerS: number;
  readonly durationMs: number;
}

/**
 * Safety-specific operations a controller MAY support. Every method
 * returns `SafetyActionResult` (T2-41) so callers always learn what
 * actually happened — port-closed, capability-unsupported, command
 * accepted, etc.
 */
export interface ControllerSafetyOps {
  laserOff(reason: string, urgency: SafetyUrgency): Promise<SafetyActionResult>;
  pauseJob(): Promise<SafetyActionResult>;
  resumeJob(): Promise<SafetyActionResult>;
  abortJob(urgency: SafetyUrgency): Promise<SafetyActionResult>;
  emergencyStop(): Promise<SafetyActionResult>;
  disconnectSafely(): Promise<SafetyActionResult>;
  beginTestFire(args: TestFireRequest): Promise<SafetyActionResult>;
  endTestFire(): Promise<SafetyActionResult>;
}

/** Names of every safety method in the contract. Canonical order. */
export const SAFETY_OP_METHODS = [
  'laserOff', 'pauseJob', 'resumeJob', 'abortJob',
  'emergencyStop', 'disconnectSafely',
  'beginTestFire', 'endTestFire',
] as const;

export type SafetyOpMethod = typeof SAFETY_OP_METHODS[number];

/**
 * Map a method name to its `SafetyAction` discriminator. Useful for
 * builders that want to populate `result.action` from the method name.
 */
export function actionForMethod(method: SafetyOpMethod): SafetyAction {
  switch (method) {
    case 'laserOff':         return 'laserOff';
    case 'pauseJob':         return 'pause';
    case 'resumeJob':        return 'resume';
    case 'abortJob':         return 'abortJob';
    case 'emergencyStop':    return 'emergencyStop';
    case 'disconnectSafely': return 'disconnectSafe';
    case 'beginTestFire':    return 'beginTestFire';
    case 'endTestFire':      return 'endTestFire';
  }
}

/**
 * Build a "capability-not-supported" refusal. Used by a controller
 * that satisfies the interface but cannot actually perform the
 * operation (e.g. a future Marlin firmware without recoverable
 * pause). UI receives the typed result and surfaces "X not
 * supported" gracefully — no throw, no silent no-op.
 */
export function makeCapabilityNotSupportedResult(
  method: SafetyOpMethod,
  detail: string,
  now: number = Date.now(),
): SafetyActionResult {
  return {
    action: actionForMethod(method),
    accepted: false,
    motionState: 'unknown',
    laserState: 'unknown',
    positionTrusted: 'unknown',
    requiresRehome: 'unknown',
    requiresReconnect: false,
    requiresInspection: false,
    message: detail,
    timestamp: now,
  };
}

/**
 * Build an "unsupported safety method" stub when a controller wants
 * to satisfy the interface but doesn't implement a method at all.
 * Returns the builder above with a generic detail.
 */
export function makeUnsupportedSafetyOps(
  reason: string,
  now: () => number = Date.now,
): ControllerSafetyOps {
  const refuse = (m: SafetyOpMethod): Promise<SafetyActionResult> =>
    Promise.resolve(makeCapabilityNotSupportedResult(m, reason, now()));
  return {
    laserOff: () => refuse('laserOff'),
    pauseJob: () => refuse('pauseJob'),
    resumeJob: () => refuse('resumeJob'),
    abortJob: () => refuse('abortJob'),
    emergencyStop: () => refuse('emergencyStop'),
    disconnectSafely: () => refuse('disconnectSafely'),
    beginTestFire: () => refuse('beginTestFire'),
    endTestFire: () => refuse('endTestFire'),
  };
}

/**
 * Predicate that the operator-button gate consults: does the
 * controller declare it can perform this safety method? Falls back
 * to inspecting the SafetyActionResult of a probe call only when
 * declarative data is unavailable; today (and in T2-42's MVP)
 * controllers can opt out by overriding the method to return
 * `accepted: false, message: capability-not-supported`.
 */
export function isSafetyOpDeclared(
  ops: ControllerSafetyOps,
  method: SafetyOpMethod,
): boolean {
  return typeof (ops as unknown as Record<string, unknown>)[method] === 'function';
}
