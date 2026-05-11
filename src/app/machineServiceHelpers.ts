/**
 * T1-145: pure top-level helpers extracted from MachineService. These
 * four functions were already pure but lived inside the 1900-line
 * service file; testing them required loading the service surface
 * (controller, profile, recovery, wifi-trust, ticket validation —
 * dozens of side-effect modules). Hoisting to a sibling module lets
 * each contract be pinned in isolation.
 *
 *   - `mutatesWorkCoordinateSystem(cmd)`: matches `G10` / `G92`
 *     (and only those — not `G100`, `G920`). Used to invalidate the
 *     saved-origin G54 snapshot after a user-approved raw console
 *     command that changes the coordinate frame outside the tracked
 *     Set Origin flow (T3-37).
 *
 *   - `safetyResultForStateMachine(result)`: translation layer
 *     between the `SafetyActionResult` shape the controller emits and
 *     the `SafetyResultLike` shape `transitionFromSafetyResult`
 *     consumes. Maps abortJob → stop, running → moving, laser-off
 *     enum → confirmed/commanded/unknown.
 *
 *   - `safetyStatesEqual(a, b)`: structural equality for SafetyState
 *     (via JSON.stringify — adequate for the snapshot shape, used
 *     only to skip no-op writes in `_setSafetyState`).
 *
 *   - `createApprovalNonce()`: cryptographically-random nonce via
 *     `crypto.randomUUID()` when available, with a `Date.now() +
 *     Math.random()` fallback for environments without WebCrypto
 *     (e.g. older test stubs).
 *
 *   - `emptyBurnState()`: factory for the empty `BurnState` shape
 *     used to reset the burn-tracker on disconnect / new job.
 */
import type { SafetyActionResult } from './SafetyActionResult';
import type {
  SafetyResultLike,
  SafetyState,
} from './SafetyStateMachine';
import type { BurnState } from './MachineService';
import type { LaserController } from '../controllers/ControllerInterface';

/**
 * Tri-state ("yes/no/unknown") for whether the controller is known
 * to halt its active job on USB disconnect. Used by MachineService's
 * disconnect-during-job guard.
 */
export type DisconnectStopsJobValue = boolean | 'unknown';

/**
 * Controller capability advert shape used by T1-155's resolver.
 * Casts are used because the production `LaserController` interface
 * doesn't carry this shape — adapters declare it on a per-family
 * basis.
 */
type DisconnectSafetyAwareController = LaserController & {
  capabilities?: {
    safety?: {
      disconnectStopsJob?: DisconnectStopsJobValue;
    };
  };
};

/**
 * Resolve whether a controller halts its active job on USB
 * disconnect. Honors a declared `capabilities.safety.disconnectStopsJob`
 * field; otherwise falls back to a per-family default — GRBL and
 * gcode-line-stream controllers default to `true` (the firmware
 * stops streaming and motion when the port closes), other families
 * fall back to `'unknown'` so the service can route through a
 * `disconnectDuringJob` recovery state.
 */
export function controllerDisconnectStopsJob(ctrl: LaserController): DisconnectStopsJobValue {
  const declared = (ctrl as DisconnectSafetyAwareController).capabilities?.safety?.disconnectStopsJob;
  if (declared === true || declared === false || declared === 'unknown') return declared;
  return ctrl.family === 'grbl' || ctrl.family === 'gcode-line-stream' ? true : 'unknown';
}

/**
 * Returns true if `command` is a G-code that mutates the work
 * coordinate system. Stock GRBL: G10 (set work offset), G92 (set
 * position). The regex uses negative lookahead `(?![0-9])` so G100
 * / G920 / G1010 don't false-match. Case-insensitive.
 */
export function mutatesWorkCoordinateSystem(command: string): boolean {
  return /^G10(?![0-9])/i.test(command) || /^G92(?![0-9])/i.test(command);
}

/**
 * Translate a controller's `SafetyActionResult` into the
 * `SafetyResultLike` shape the state machine consumes:
 *   - action: `abortJob` → `stop`; otherwise passthrough.
 *   - motionState: `running` → `moving`; otherwise passthrough.
 *   - laserState: `off` → `confirmed`; `commandedOff` → `commanded`;
 *     anything else → `unknown`.
 */
export function safetyResultForStateMachine(result: SafetyActionResult): SafetyResultLike {
  const action: SafetyResultLike['action'] =
    result.action === 'abortJob' ? 'stop' : result.action;
  const motionState: SafetyResultLike['motionState'] =
    result.motionState === 'running' ? 'moving' : result.motionState;
  const laserState: SafetyResultLike['laserState'] =
    result.laserState === 'off'
      ? 'confirmed'
      : result.laserState === 'commandedOff'
        ? 'commanded'
        : 'unknown';

  return {
    action,
    accepted: result.accepted,
    motionState,
    laserState,
    positionTrusted: result.positionTrusted,
    requiresRehome: result.requiresRehome,
    requiresReconnect: result.requiresReconnect,
    requiresInspection: result.requiresInspection,
    message: result.message,
  };
}

/**
 * Structural equality for `SafetyState`. Uses `JSON.stringify` — fine
 * for the snapshot shape (no functions, no circular refs). Used only
 * to skip no-op writes in `_setSafetyState`.
 */
export function safetyStatesEqual(a: SafetyState, b: SafetyState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Create a fresh approval-token nonce. Uses `crypto.randomUUID()`
 * when available (modern browsers, Node 19+), with a deterministic-ish
 * fallback for legacy environments. The fallback uses `Date.now()` +
 * `Math.random()` — sufficient because nonces are single-use
 * cryptographic-look-alike strings, not security keys.
 */
export function createApprovalNonce(): string {
  const cryptoLike = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoLike?.randomUUID === 'function') {
    return cryptoLike.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Factory for the empty `BurnState` shape. */
export function emptyBurnState(): BurnState {
  return {
    activeIds: new Set<string>(),
    burnedIds: new Set<string>(),
  };
}
