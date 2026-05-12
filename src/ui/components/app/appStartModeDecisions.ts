/**
 * T2-6 Phase 3y: pure predicates for the two startMode auto-switch
 * useEffects in App.tsx.
 *
 * Pre-Phase-3y both decisions lived inline as 3-clause AND chains
 * inside the useEffect bodies. The conditions themselves were
 * already readable, but pulling them out names the policy and
 * makes the corner cases (which combinations flip, which don't)
 * exhaustively testable in isolation from React.
 *
 * Both predicates are pure: no side effects, no machine commands,
 * no React. Safe to call from any render or effect.
 */
import { type GcodeStartMode } from '../../../core/output/GcodeOrigin';
import {
  shouldDefaultStartModeToCurrentForProfile,
  type DeviceProfile,
} from '../../../core/devices/DeviceProfile';
import { type MachineStatus } from '../../../controllers/ControllerInterface';

/**
 * Decide whether to reset `startMode` from `'current'` back to
 * `'absolute'` after the machine disconnects.
 *
 * Rationale: `'current'` start-mode is head-relative (G91-style) and
 * is only meaningful while a machine is online. Leaving it set
 * after disconnect would confuse the next connect — the user would
 * see a "start from laser head" choice that has no laser head to
 * start from. Profiles that intentionally prefer `'current'` as
 * their default (PRT4040 router-laser, others flagged by
 * `shouldDefaultStartModeToCurrentForProfile`) keep the setting
 * across the disconnect so reconnecting doesn't bounce the user
 * back to a mode they don't want.
 *
 * Returns `true` precisely when ALL three conditions hold:
 *   1. The machine status is `'disconnected'`.
 *   2. The current startMode is `'current'` (the only mode that
 *      gets reset; `'absolute'` and `'savedOrigin'` stay put).
 *   3. The active profile does NOT default to current-mode.
 */
export function shouldResetStartModeAfterDisconnect(input: {
  readonly machineStatus: MachineStatus | null | undefined;
  readonly currentStartMode: GcodeStartMode;
  readonly activeProfile: DeviceProfile | null | undefined;
}): boolean {
  return input.machineStatus === 'disconnected'
    && input.currentStartMode === 'current'
    && !shouldDefaultStartModeToCurrentForProfile(input.activeProfile);
}

/**
 * Decide whether to nudge `startMode` from `'absolute'` to
 * `'current'` on profile activation.
 *
 * Only profiles flagged by `shouldDefaultStartModeToCurrentForProfile`
 * get the nudge; everyone else keeps whatever start mode the user
 * previously selected. The nudge runs once per profile activation
 * (the App.tsx caller guards repeat invocations via a ref); this
 * predicate doesn't track the once-per-profile gate — it only
 * answers the "would the nudge apply here?" question.
 *
 * Returns `true` precisely when BOTH conditions hold:
 *   1. The active profile prefers `'current'` as its default
 *      start-mode.
 *   2. The current startMode is `'absolute'` (the only mode the
 *      nudge moves; `'current'` is the target so already-there
 *      is a no-op, and `'savedOrigin'` is a deliberate user
 *      choice we don't overwrite).
 */
export function shouldNudgeStartModeToCurrent(input: {
  readonly activeProfile: DeviceProfile | null | undefined;
  readonly currentStartMode: GcodeStartMode;
}): boolean {
  return shouldDefaultStartModeToCurrentForProfile(input.activeProfile)
    && input.currentStartMode === 'absolute';
}
