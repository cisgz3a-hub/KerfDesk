/**
 * T1-206: pure mapping from runtime `RecoveryState` (the canonical
 * runtime shape) to the UI's `RecoveryVariant` (the card shape).
 *
 * The two unions don't quite match 1:1 — `RecoveryState` distinguishes
 * `compileFailed` while the card layer uses `job-failed`. Kept here
 * so the mapping is testable in isolation and so the `RecoveryMode`
 * component stays as small as possible.
 *
 * Also surfaces alarm-status fallback: when the machine reports
 * `'alarm'` or `'faulted_requires_inspection'` but `RecoveryState`
 * itself is still `'none'` (transient state right after the alarm
 * fires, before the service raises recovery), we still want the
 * `alarm` card to render. The caller's `derivePanelMode` puts the
 * panel in `recovery` mode for both signals; this helper picks the
 * right card variant for either trigger.
 */
import type { MachineStatus } from '../../../controllers/ControllerInterface';
import type { RecoveryState } from '../../../runtime/RecoveryState';
import type { RecoveryVariant } from '../../recovery/RecoveryCardContent';

export interface RecoveryVariantInput {
  readonly recoveryState: RecoveryState;
  readonly machineStatus: MachineStatus | null;
  readonly alarmCode: number | null;
}

export interface RecoveryVariantResult {
  readonly variant: RecoveryVariant;
  /** alarmCode for the `'alarm'` variant; null otherwise. */
  readonly alarmCode: number | null;
  /** frameTimeoutSec for the `'frame-failed'` variant; null otherwise. */
  readonly frameTimeoutSec: number | null;
  /** errorMessage for the `'job-failed'` variant; null otherwise. */
  readonly errorMessage: string | null;
}

/**
 * Pick the recovery card variant + its content fields from the
 * current state. Precedence: an active RecoveryState always beats
 * the bare machineStatus signal (the state machine is the
 * authoritative source); alarm/fault statuses without an active
 * RecoveryState fall through to a synthesised alarm card.
 */
export function recoveryVariantFromState(
  input: RecoveryVariantInput,
): RecoveryVariantResult {
  const { recoveryState, machineStatus, alarmCode } = input;
  switch (recoveryState.status) {
    case 'alarm':
      return {
        variant: 'alarm',
        alarmCode: recoveryState.alarmCode,
        frameTimeoutSec: null,
        errorMessage: null,
      };
    case 'disconnectDuringJob':
      return {
        variant: 'disconnect',
        alarmCode: null,
        frameTimeoutSec: null,
        errorMessage: null,
      };
    case 'emergencyStopped':
      return {
        variant: 'emergency-stop',
        alarmCode: null,
        frameTimeoutSec: null,
        errorMessage: null,
      };
    case 'frameFailed':
      return {
        variant: 'frame-failed',
        alarmCode: null,
        // The runtime stores a structured reason; the card builder
        // takes a numeric timeout. Default to 15s — matches the
        // existing frameFailedRecoveryCard default.
        frameTimeoutSec: 15,
        errorMessage: null,
      };
    case 'compileFailed':
      return {
        variant: 'job-failed',
        alarmCode: null,
        frameTimeoutSec: null,
        errorMessage: recoveryState.errorMessage,
      };
    case 'none':
      // Status-based fallback: alarm or fault status without an
      // active RecoveryState. Caller's derivePanelMode already
      // routed us into recovery mode for these statuses.
      if (machineStatus === 'alarm' || machineStatus === 'faulted_requires_inspection') {
        return {
          variant: 'alarm',
          alarmCode,
          frameTimeoutSec: null,
          errorMessage: null,
        };
      }
      // Defensive default — should not be reachable when caller
      // gates on the panel-mode being 'recovery'.
      return {
        variant: 'alarm',
        alarmCode: null,
        frameTimeoutSec: null,
        errorMessage: null,
      };
  }
}
