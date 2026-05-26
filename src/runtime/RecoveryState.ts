/**
 * T2-87: explicit `RecoveryState` state machine. Pre-T2-87 recovery
 * was implicit — alarm banner, unlock button, message log, scattered
 * preflight blockers. No unified "recovery is required and incomplete"
 * state, so `canStart` couldn't reliably gate on it.
 *
 * Audit 4F Critical 7 + Required Priority 5. T2-87 composes T2-62
 * (recovery cards UI), T2-66 (positionTrusted, shipped in `f9fe0ff`),
 * and T2-67 (job outcome enum) into a single discriminated union
 * with per-status checklist of required steps.
 *
 * GRBL4040 update: the production Start path now gates on live
 * controller/preflight evidence instead of this advisory checklist.
 * `recoveryAllowsStart` remains for state-machine consumers and tests;
 * recovery transitions to `'none'` only when ALL required steps for the
 * active recovery have been completed.
 *
 * T2-87 ships the type + the trigger functions + the per-step
 * acknowledgement transitions. Wiring this into MachineService /
 * the canStart chain is filed as T2-87-followup since it touches
 * App.tsx + ConnectionPanelMain + the existing alarm-handling.
 */

/** Reason a frame attempt failed — mirrors T2-86 FrameFailureReason. */
export type FrameFailReason =
  | 'no-controller' | 'idle-timeout' | 'command-failed'
  | 'machine-alarm' | 'disconnected' | 'cancelled' | 'unknown';

/**
 * What still needs to happen for recovery to clear. Each `requires*`
 * flag flips as the user completes the step; recovery transitions
 * to 'none' when EVERY required flag is false (i.e. step done).
 *
 * The fields are stored as `done` flags rather than `required` so
 * the transition function reads naturally: `r.unlockDone && r.homeDone
 * && r.frameDone`.
 */

export type RecoveryState =
  | { status: 'none' }
  | {
      status: 'alarm';
      alarmCode: number;
      occurredAt: number;
      requiresRehome: boolean;     // true unless homing not supported
      inspectionDone: boolean;
      unlockDone: boolean;
      rehomeDone: boolean;          // ignored when requiresRehome=false
      reframeDone: boolean;
    }
  | {
      status: 'disconnectDuringJob';
      occurredAt: number;
      lastJobLine: number;
      requiresRehome: boolean;
      reconnectDone: boolean;
      rehomeDone: boolean;
      reframeDone: boolean;
    }
  | {
      status: 'emergencyStopped';
      occurredAt: number;
      reconnectDone: boolean;
      rehomeDone: boolean;
      reframeDone: boolean;
    }
  | {
      status: 'frameFailed';
      reason: FrameFailReason;
      occurredAt: number;
      reframeDone: boolean;
    }
  | {
      status: 'compileFailed';
      errorMessage: string;
      occurredAt: number;
      recompileDone: boolean;
    };

export type RecoveryStatus = RecoveryState['status'];

export const recoveryStateInitial: RecoveryState = { status: 'none' };

// ─── start gate ───────────────────────────────────────────

export function recoveryAllowsStart(r: RecoveryState): boolean {
  return r.status === 'none';
}

// ─── triggers (enter recovery state) ──────────────────────

/**
 * When two recovery causes fire concurrently, the SEVERITY ordering
 * decides which wins:
 *   emergencyStopped > alarm > disconnectDuringJob > compileFailed > frameFailed
 *
 * Rationale: e-stop is the strongest signal that machine state is
 * unsafe; alarm is firmware-flagged unsafe; disconnect-during-job
 * means the host lost its tether mid-motion; compile failure blocks
 * Start broadly; frame failure is recoverable with one re-frame.
 */
const SEVERITY_RANK: Record<RecoveryStatus, number> = {
  emergencyStopped: 5,
  alarm: 4,
  disconnectDuringJob: 3,
  compileFailed: 2,
  frameFailed: 1,
  none: 0,
};

function shouldOverride(current: RecoveryState, next: RecoveryStatus): boolean {
  return SEVERITY_RANK[next] >= SEVERITY_RANK[current.status];
}

export function triggerAlarm(args: {
  current: RecoveryState;
  alarmCode: number;
  occurredAt: number;
  requiresRehome: boolean;
}): RecoveryState {
  if (!shouldOverride(args.current, 'alarm')) return args.current;
  return {
    status: 'alarm',
    alarmCode: args.alarmCode,
    occurredAt: args.occurredAt,
    requiresRehome: args.requiresRehome,
    inspectionDone: false,
    unlockDone: false,
    rehomeDone: false,
    reframeDone: false,
  };
}

export function triggerDisconnectDuringJob(args: {
  current: RecoveryState;
  occurredAt: number;
  lastJobLine: number;
  requiresRehome: boolean;
}): RecoveryState {
  if (!shouldOverride(args.current, 'disconnectDuringJob')) return args.current;
  return {
    status: 'disconnectDuringJob',
    occurredAt: args.occurredAt,
    lastJobLine: args.lastJobLine,
    requiresRehome: args.requiresRehome,
    reconnectDone: false,
    rehomeDone: false,
    reframeDone: false,
  };
}

export function triggerEmergencyStop(args: {
  current: RecoveryState;
  occurredAt: number;
}): RecoveryState {
  if (!shouldOverride(args.current, 'emergencyStopped')) return args.current;
  return {
    status: 'emergencyStopped',
    occurredAt: args.occurredAt,
    reconnectDone: false,
    rehomeDone: false,
    reframeDone: false,
  };
}

export function triggerFrameFailed(args: {
  current: RecoveryState;
  reason: FrameFailReason;
  occurredAt: number;
}): RecoveryState {
  if (!shouldOverride(args.current, 'frameFailed')) return args.current;
  return {
    status: 'frameFailed',
    reason: args.reason,
    occurredAt: args.occurredAt,
    reframeDone: false,
  };
}

export function triggerCompileFailed(args: {
  current: RecoveryState;
  errorMessage: string;
  occurredAt: number;
}): RecoveryState {
  if (!shouldOverride(args.current, 'compileFailed')) return args.current;
  return {
    status: 'compileFailed',
    errorMessage: args.errorMessage,
    occurredAt: args.occurredAt,
    recompileDone: false,
  };
}

// ─── per-step acknowledgements ────────────────────────────

/**
 * Mark one step done. After every step, checkRecoveryComplete
 * decides whether to transition the recovery to 'none'.
 */
type StepKey =
  | 'inspectionDone' | 'unlockDone' | 'rehomeDone' | 'reframeDone'
  | 'reconnectDone' | 'recompileDone';

function setStep(current: RecoveryState, step: StepKey, value: boolean): RecoveryState {
  if (current.status === 'none') return current;
  if (!(step in current)) return current;
  // The cast is safe because the caller is providing a step the
  // current status supports (inspection on alarm, reconnect on
  // disconnect/e-stop, etc.).
  return { ...(current as object), [step]: value } as unknown as RecoveryState;
}

export function ackInspection(current: RecoveryState): RecoveryState {
  return checkRecoveryComplete(setStep(current, 'inspectionDone', true));
}

export function ackUnlock(current: RecoveryState): RecoveryState {
  return checkRecoveryComplete(setStep(current, 'unlockDone', true));
}

export function ackRehome(current: RecoveryState): RecoveryState {
  return checkRecoveryComplete(setStep(current, 'rehomeDone', true));
}

export function ackReframe(current: RecoveryState): RecoveryState {
  return checkRecoveryComplete(setStep(current, 'reframeDone', true));
}

export function ackReconnect(current: RecoveryState): RecoveryState {
  return checkRecoveryComplete(setStep(current, 'reconnectDone', true));
}

export function ackRecompile(current: RecoveryState): RecoveryState {
  return checkRecoveryComplete(setStep(current, 'recompileDone', true));
}

/**
 * Returns 'none' when the active recovery's required steps are all
 * done; otherwise returns the current state (with the most-recent
 * ack applied by the caller).
 */
export function checkRecoveryComplete(current: RecoveryState): RecoveryState {
  switch (current.status) {
    case 'none':
      return current;
    case 'alarm':
      if (current.inspectionDone && current.unlockDone
          && (!current.requiresRehome || current.rehomeDone)
          && current.reframeDone) {
        return { status: 'none' };
      }
      return current;
    case 'disconnectDuringJob':
      if (current.reconnectDone
          && (!current.requiresRehome || current.rehomeDone)
          && current.reframeDone) {
        return { status: 'none' };
      }
      return current;
    case 'emergencyStopped':
      if (current.reconnectDone && current.rehomeDone && current.reframeDone) {
        return { status: 'none' };
      }
      return current;
    case 'frameFailed':
      return current.reframeDone ? { status: 'none' } : current;
    case 'compileFailed':
      return current.recompileDone ? { status: 'none' } : current;
  }
}

/**
 * User-explicit "I have inspected and acknowledge it's safe" clear.
 * Used by the recovery card's "I'm done — reset" button after the
 * user has done all the physical-world steps.
 */
export function clearRecovery(): RecoveryState {
  return { status: 'none' };
}

/**
 * The list of incomplete steps the UI renders as a checklist. Empty
 * for status='none'.
 */
export interface PendingStep {
  key: StepKey;
  label: string;
}

export function pendingSteps(r: RecoveryState): PendingStep[] {
  switch (r.status) {
    case 'none': return [];
    case 'alarm': {
      const steps: PendingStep[] = [];
      if (!r.inspectionDone) steps.push({ key: 'inspectionDone', label: 'Inspect machine' });
      if (!r.unlockDone) steps.push({ key: 'unlockDone', label: 'Click Unlock ($X)' });
      if (r.requiresRehome && !r.rehomeDone) steps.push({ key: 'rehomeDone', label: 'Re-home' });
      if (!r.reframeDone) steps.push({ key: 'reframeDone', label: 'Frame again' });
      return steps;
    }
    case 'disconnectDuringJob': {
      const steps: PendingStep[] = [];
      if (!r.reconnectDone) steps.push({ key: 'reconnectDone', label: 'Reconnect' });
      if (r.requiresRehome && !r.rehomeDone) steps.push({ key: 'rehomeDone', label: 'Re-home' });
      if (!r.reframeDone) steps.push({ key: 'reframeDone', label: 'Frame again' });
      return steps;
    }
    case 'emergencyStopped': {
      const steps: PendingStep[] = [];
      if (!r.reconnectDone) steps.push({ key: 'reconnectDone', label: 'Reconnect' });
      if (!r.rehomeDone) steps.push({ key: 'rehomeDone', label: 'Re-home' });
      if (!r.reframeDone) steps.push({ key: 'reframeDone', label: 'Frame again' });
      return steps;
    }
    case 'frameFailed':
      return r.reframeDone ? [] : [{ key: 'reframeDone', label: 'Frame again' }];
    case 'compileFailed':
      return r.recompileDone ? [] : [{ key: 'recompileDone', label: 'Recompile' }];
  }
}

/** User-facing label for the recovery card header. */
export function recoveryLabel(r: RecoveryState): string {
  switch (r.status) {
    case 'none': return '';
    case 'alarm': return `Recovery required: Alarm ${r.alarmCode}`;
    case 'disconnectDuringJob': return 'Recovery required: Disconnect during job';
    case 'emergencyStopped': return 'Recovery required: Emergency-stopped';
    case 'frameFailed': return `Recovery required: Frame failed (${r.reason})`;
    case 'compileFailed': return 'Recovery required: Compile failed';
  }
}
