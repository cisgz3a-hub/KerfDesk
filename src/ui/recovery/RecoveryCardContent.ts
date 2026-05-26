/**
 * T2-62: recovery cards (alarm / disconnect / frame-fail / E-stop /
 * job-fail). Pre-T2-62 recovery was an alarm banner ("Click Unlock
 * to clear"), connection-failure log strings, frame-failure
 * messages — short alert/log strings without next-step guidance.
 * Each major error state needs a card answering: what happened,
 * why it matters, what to do now, what NOT to do.
 *
 * Audit 4B Critical UX failure 5 + Priority 7 + Section 10.
 *
 * T2-62 ships the structured content layer (typed variant + the
 * What/Why/Do/Don't shape + a builder per kind) so the React
 * component (T2-62-followup) can render in isolation. Refines
 * T2-46 (user-facing safety messages from audit 3D) — T2-46 is
 * the in-the-moment toast/banner copy; T2-62 is the persistent
 * recovery surface with next-step buttons.
 */
import { describeGrblAlarmCode } from '../../controllers/grbl/GrblAlarmPolicy';

export type RecoveryVariant =
  | 'alarm'
  | 'disconnect'
  | 'frame-failed'
  | 'emergency-stop'
  | 'job-failed';

export type RecoveryAction =
  | 'inspect'
  | 'unlock'
  | 'home'
  | 're-home'
  | 'reconnect'
  | 'reframe'
  | 'frame'
  | 'stop'
  | 'compile';

export interface RecoveryStep {
  readonly text: string;
  /** When set, the step has a primary button the UI should render. */
  readonly action?: RecoveryAction;
}

export interface RecoveryCardContent {
  readonly variant: RecoveryVariant;
  readonly title: string;
  readonly whatHappened: string;
  readonly whatItMeans: string;
  readonly steps: readonly RecoveryStep[];
  /** "Do not" warning — null when no anti-pattern to call out. */
  readonly doNot: string | null;
}

/** Build the alarm-recovery card. `alarmCode` from GRBL ALARM:N. */
export function alarmRecoveryCard(alarmCode: number | null): RecoveryCardContent {
  const reason = alarmCode != null
    ? `GRBL reported ALARM:${alarmCode} (${alarmCodeReason(alarmCode)})`
    : 'GRBL reported an alarm';
  return {
    variant: 'alarm',
    title: 'Machine Alarm',
    whatHappened: `${reason}.`,
    whatItMeans:
      'The machine attempted a move outside its known safe area, or homing did not succeed. Position may be unreliable.',
    steps: [
      // T1-242: alarm recovery's runtime checklist has an
      // inspectionDone step. The UI needs a real action button for it;
      // otherwise the visible recovery flow can never clear Start.
      { text: 'Inspect the machine for obstructions or material in the way.', action: 'inspect' },
      { text: 'If safe, click Unlock to clear the alarm.', action: 'unlock' },
      { text: 'Re-home the machine to re-establish position.', action: 're-home' },
      { text: 'Re-frame the job before starting again. (Required by app)', action: 'reframe' },
    ],
    doNot: 'Click Start before re-framing. Position may be wrong even after unlock.',
  };
}

export function disconnectRecoveryCard(): RecoveryCardContent {
  return {
    variant: 'disconnect',
    title: 'Connection Lost',
    whatHappened: 'USB connection to the machine was interrupted.',
    whatItMeans:
      'Job state is unknown. The laser may still be on. The machine may still be moving.',
    steps: [
      { text: 'Check that the laser is OFF (look at the machine).' },
      { text: 'Inspect material for damage.' },
      { text: 'Reconnect.', action: 'reconnect' },
      { text: 'Re-home or set origin again.', action: 're-home' },
      { text: 'Frame again before starting.', action: 'frame' },
    ],
    doNot: 'Resume the previous job. Compile a fresh one.',
  };
}

export function frameFailedRecoveryCard(timeoutSec: number): RecoveryCardContent {
  return {
    variant: 'frame-failed',
    title: 'Frame Failed',
    whatHappened: `Machine did not return to idle within ${timeoutSec} seconds during framing.`,
    whatItMeans: 'Framing did not complete. Machine state may be unreliable.',
    steps: [
      { text: 'Check machine status: is it moving, paused, or idle?' },
      { text: 'If still moving, wait or click Stop.', action: 'stop' },
      { text: 'If safe and idle, try Frame again.', action: 'frame' },
      { text: 'If repeated failures, check for hardware issues (limit switches, motor drivers).' },
    ],
    doNot: null,
  };
}

export function emergencyStopRecoveryCard(): RecoveryCardContent {
  return {
    variant: 'emergency-stop',
    title: 'Emergency Stop Complete',
    whatHappened: 'Machine reset and connection closed.',
    whatItMeans:
      'Position is lost. The machine is in a clean reset state but does not know where it is.',
    steps: [
      { text: 'Inspect the machine, material, and any visible damage.' },
      { text: 'Reconnect.', action: 'reconnect' },
      { text: 'Re-home (required — position is lost).', action: 'home' },
      { text: 'Frame the job again before pressing Start.', action: 'frame' },
    ],
    doNot: 'Reconnect and immediately Start the previous job.',
  };
}

export function jobFailedRecoveryCard(errorMessage: string): RecoveryCardContent {
  return {
    variant: 'job-failed',
    title: 'Job Failed',
    whatHappened: errorMessage,
    whatItMeans:
      'The job did not complete. Material may be partially burned. Machine may need attention.',
    steps: [
      { text: 'Stop the machine if it is still moving.', action: 'stop' },
      { text: 'Inspect material and laser head.' },
      { text: 'Compile a fresh job before retrying.', action: 'compile' },
    ],
    doNot: 'Restart the job without inspecting why it failed.',
  };
}

/** GRBL alarm-code reasons (1.1 spec). */
export function alarmCodeReason(code: number): string {
  return describeGrblAlarmCode(code);
}

/** Map a variant to the card builder. Used by tests + UI router. */
export function buildRecoveryCard(opts: {
  variant: RecoveryVariant;
  alarmCode?: number | null;
  frameTimeoutSec?: number;
  errorMessage?: string;
}): RecoveryCardContent {
  switch (opts.variant) {
    case 'alarm':           return alarmRecoveryCard(opts.alarmCode ?? null);
    case 'disconnect':      return disconnectRecoveryCard();
    case 'frame-failed':    return frameFailedRecoveryCard(opts.frameTimeoutSec ?? 15);
    case 'emergency-stop':  return emergencyStopRecoveryCard();
    case 'job-failed':      return jobFailedRecoveryCard(opts.errorMessage ?? 'Job failed.');
  }
}

/** Predicate the card-router consults: should this card show now? */
export function shouldShowRecoveryCard(opts: {
  controllerStatus: 'idle' | 'run' | 'hold' | 'jog' | 'alarm' | 'door' | 'check' | 'home' | 'sleep' | 'unknown';
  recovery: RecoveryVariant | 'none';
}): boolean {
  return opts.recovery !== 'none';
}
