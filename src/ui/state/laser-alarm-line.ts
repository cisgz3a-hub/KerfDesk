// laser-alarm-line — maps a numbered `ALARM:N` into LaserState. Split from
// laser-line-handler at the 400-line cap.

import type { GrblPins } from '../../core/controllers/grbl';
import { cancelControllerLifecycleRefs } from './laser-interactive-command';
import type { GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import { noteAlarmBeforeBanner } from './laser-reset-alarm';
import { frameHitLimitNotice } from './laser-safety-notice';
import { originUnknownAfterControllerReset } from './laser-status-line';
import { advanceStream } from './laser-stream-ack';
import { probeAlarmKeepsToolChangeHold } from './tool-change-probe-alarm';

// GRBL ALARM:1 — hard limit triggered (see alarm-codes.ts).
const HARD_LIMIT_ALARM_CODE = 1;

export function handleAlarmLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  code: number,
): void {
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  // A hard-limit alarm that fires while a Verified Frame is tracing means the
  // job box runs past the travel from this origin — name the limit so the
  // operator knows which way to move (ADR-053 P3). The alarm also clears the
  // origin + frame verification.
  const prev = get();
  const frameLimitPatch =
    prev.motionOperation?.kind === 'frame' && code === HARD_LIMIT_ALARM_CODE
      ? { safetyNotice: frameHitLimitNotice(activeLimitAxisLabel(prev.statusReport?.pins ?? null)) }
      : {};
  // A missed touch-off probe stops the probe, not the held job; Continue waits
  // for a fresh Idle again (tool-change-probe-alarm.ts).
  const keepToolChangeHold = probeAlarmKeepsToolChangeHold(prev, code);
  set({
    alarmCode: code,
    ...(keepToolChangeHold ? { toolChangeIdleSeen: false } : {}),
    // ALARM:N supersedes any prior Run/Hold report. Clearing it lets the
    // numbered alarm itself be the exact recovery evidence for Home.
    statusReport: null,
    wcoCache: null,
    accessoryCache: null,
    // ALARM:N is not a new transport session, so it cannot clear a latched
    // pendant owner. Only explicit MPG:0 or session replacement may do that.
    mpgActive: prev.mpgActive ?? null,
    ...originUnknownAfterControllerReset(prev),
    motionOperation: null,
    controllerOperation: null,
    fireActive: false,
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
    statusObservation: null,
    homingState: 'unknown',
    homingProof: null,
    trustedPositionEpoch: (prev.trustedPositionEpoch ?? 0) + 1,
    // The alarmed controller discards its pending work; owed acks are gone.
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    ...frameLimitPatch,
  });
  cancelControllerLifecycleRefs(refs, `ALARM:${code}`);
  noteAlarmBeforeBanner(refs, code);
  if (!keepToolChangeHold) advanceStream(set, get, refs, safeWrite, 'alarm');
}

function activeLimitAxisLabel(pins: GrblPins | null): string | null {
  if (pins === null) return null;
  const axes: string[] = [];
  if (pins.limitX) axes.push('X');
  if (pins.limitY) axes.push('Y');
  if (pins.limitZ) axes.push('Z');
  return axes.length > 0 ? axes.join('/') : null;
}
