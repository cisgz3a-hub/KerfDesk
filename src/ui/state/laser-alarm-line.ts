// laser-alarm-line — maps a controller alarm into LaserState: GRBL's numbered
// `ALARM:N`, or a code-less text alarm (Smoothieware `ALARM: Hard limit +X`,
// controller audit SM-8). Neither answers a line, so neither settles an owed
// acknowledgement; both stop a running stream. Split from laser-line-handler
// at the 400-line cap.

import type { ControllerEvent } from '../../core/controllers';
import type { GrblPins } from '../../core/controllers/grbl';
import { cancelControllerLifecycleRefs } from './laser-interactive-command';
import type { GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import { noteAlarmBeforeBanner } from './laser-reset-alarm';
import { frameHitLimitNotice } from './laser-safety-notice';
import { originUnknownAfterControllerReset } from './laser-status-line';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { advanceStream } from './laser-stream-ack';
import { probeAlarmKeepsToolChangeHold } from './tool-change-probe-alarm';

type AlarmEvent = Extract<ControllerEvent, { readonly kind: 'alarm' }>;

// GRBL ALARM:1 — hard limit triggered (see alarm-codes.ts).
const HARD_LIMIT_ALARM_CODE = 1;
// Endstops::on_idle prints `ALARM: Hard limit <+|-><axis>` (Endstops.cpp L426).
const TEXT_HARD_LIMIT_RE = /\bHard limit [+-]([XYZABC])\b/i;

export function handleAlarmLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  alarm: AlarmEvent,
): void {
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  // A hard-limit alarm that fires while a Verified Frame is tracing means the
  // job box runs past the travel from this origin — name the limit so the
  // operator knows which way to move (ADR-053 P3). The alarm also clears the
  // origin + frame verification.
  const prev = get();
  // A missed touch-off probe stops the probe, not the held job; Continue waits
  // for a fresh Idle again (tool-change-probe-alarm.ts). A text alarm names no
  // probe code, so it never keeps the hold.
  const keepToolChangeHold = alarm.code !== null && probeAlarmKeepsToolChangeHold(prev, alarm.code);
  set({
    ...alarmRecordPatch(prev, alarm),
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
    ...frameLimitPatch(prev, alarm),
  });
  cancelControllerLifecycleRefs(refs, alarm.code === null ? alarm.raw : `ALARM:${alarm.code}`);
  if (alarm.code !== null) noteAlarmBeforeBanner(refs, alarm.code);
  if (!keepToolChangeHold) advanceStream(set, get, refs, safeWrite, 'alarm');
}

// A numbered alarm is recorded as its code; a text alarm has none, so its raw
// line goes to the log and the Alarm status that follows drives the banner.
function alarmRecordPatch(
  prev: LaserState,
  alarm: AlarmEvent,
): Partial<Pick<LaserState, 'alarmCode' | 'log'>> {
  if (alarm.code !== null) return { alarmCode: alarm.code };
  return { log: pushLog(prev, `[lf2] Controller alarm: ${alarm.raw}`) };
}

function frameLimitPatch(
  prev: LaserState,
  alarm: AlarmEvent,
): Partial<Pick<LaserState, 'safetyNotice'>> {
  if (prev.motionOperation?.kind !== 'frame') return {};
  if (alarm.code === HARD_LIMIT_ALARM_CODE) {
    return {
      safetyNotice: frameHitLimitNotice(activeLimitAxisLabel(prev.statusReport?.pins ?? null)),
    };
  }
  const textLimit = alarm.code === null ? TEXT_HARD_LIMIT_RE.exec(alarm.raw) : null;
  return textLimit === null ? {} : { safetyNotice: frameHitLimitNotice(textLimit[1] ?? null) };
}

function activeLimitAxisLabel(pins: GrblPins | null): string | null {
  if (pins === null) return null;
  const axes: string[] = [];
  if (pins.limitX) axes.push('X');
  if (pins.limitY) axes.push('Y');
  if (pins.limitZ) axes.push('Z');
  return axes.length > 0 ? axes.join('/') : null;
}
