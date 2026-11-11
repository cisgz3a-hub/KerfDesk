// After the operator's ABORT JOB on a laser without homing, put the origin
// back without a click (user annoyance audit A1, finding A3-D-1; ADR-341
// Amendment 14).
//
// Every Abort on stock GRBL or FluidNC ended locked in ALARM:3 with the origin
// cleared, and the operator had to press Restore saved origin on the "You
// stopped the job" card before the next Frame. On a machine without homing
// that button moves nothing: it sends Unlock and one G92. This watcher presses
// it for the operator, once, when abort-auto-restore-eligibility.ts allows.
//
// What it must never do:
// - change how Abort stops. The reset still goes out at once; this runs only
//   after the controller has reported Alarm twice with nothing in flight;
// - move the head or switch the beam on. It calls the card's own
//   restoreOriginAfterAbort without Home and without a rotary turn;
// - run twice, run after the operator pressed a card button, or run for an
//   alarm it did not watch arrive (a remount, a reload);
// - hide the stop. The toast says the job was stopped, and the interrupted
//   job's card stays in the rail. A failure is told and the card keeps its
//   buttons.
// Start still needs a new Frame: the reset cleared the Frame evidence, and the
// restore issues no permit.

import { useEffect } from 'react';
import { create } from 'zustand';
import { rotaryWrapLimitMm } from '../../core/job';
import { rotaryOutputAxis } from '../../core/job/rotary-job';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { currentJobStopRequest, type JobStopRequest } from '../state/job-stop-request';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { operatorAbortAlarm, restoreOriginAfterAbort } from './abort-alarm-recovery';
import {
  abortAutoRestoreVerdict,
  type AbortAutoRestoreProfile,
} from './abort-auto-restore-eligibility';
import { reportControllerActionFailure } from './report-controller-action-failure';

export const ABORT_ORIGIN_RESTORED_MESSAGE =
  'Stopped. The laser is off and your origin is restored. Frame to check before starting again.';

export const ABORT_AUTO_RESTORE_FAILED_LABEL =
  'Stopped. The laser is off, but your origin was not restored automatically';

/** The automatic restore runs only this soon after the Abort. A controller
 *  that takes longer to raise its alarm and settle keeps the card. */
export const ABORT_AUTO_RESTORE_WINDOW_MS = 10_000;

type AutoRestoreState = {
  /** The Abort whose origin is being put back right now. */
  readonly running: JobStopRequest | null;
  /** The Abort whose automatic restore did not happen, and why. */
  readonly failure: { readonly request: JobStopRequest; readonly reason: string } | null;
};

/** What the card shows of the automatic restore. */
export const useAbortAutoRestoreStore = create<AutoRestoreState>(() => ({
  running: null,
  failure: null,
}));

// One decision per Abort, keyed by the stop request the store holds for it.
const decided = new WeakSet<JobStopRequest>();

/** The operator pressed a button on the Abort card: the choice is theirs now,
 *  and the automatic restore never runs for this Abort. */
export function noteOperatorAbortRecovery(request: JobStopRequest): void {
  decided.add(request);
}

function readProfile(): AbortAutoRestoreProfile {
  const { device, machine } = useStore.getState().project;
  return {
    homingEnabled: device.homing.enabled,
    machineKind: machineKindOf(machine),
    rotaryActive:
      rotaryOutputAxis(device, machine) !== null || rotaryWrapLimitMm(device, machine) !== null,
  };
}

type Watched = {
  readonly request: JobStopRequest;
  /** When the stop request was first seen: the Abort itself. */
  readonly seenAt: number;
  /** The Abort's ALARM:3 has been on screen. */
  alarmSeen: boolean;
  /** The status report count when the alarm was first seen settled. */
  settledSequence: number | null;
};

/** Watch the laser store and run the automatic restore. Returns the uninstall. */
export function installAbortAutoRestore(now: () => number = Date.now): () => void {
  let watched: Watched | null = null;
  // An Abort already on screen was not watched as it settled: leave its card.
  const standing = currentJobStopRequest(useLaserStore.getState());
  if (standing !== null) decided.add(standing);
  return useLaserStore.subscribe((laser) => {
    // The stop request outlives its alarm: it stays the current stream's until
    // the next job, and a later ALARM:3 (an aborted Frame) shows the card for it
    // again. So the watch starts at the Abort, not at an alarm, and a request
    // that leaves view is decided for good.
    const request = currentJobStopRequest(laser);
    if (watched !== null && watched.request !== request) {
      decided.add(watched.request);
      watched = null;
    }
    if (request === null || decided.has(request)) {
      watched = null;
      return;
    }
    watched ??= { request, seenAt: now(), alarmSeen: false, settledSequence: null };
    if (!restoreNow(laser, watched, now())) return;
    decided.add(request);
    watched = null;
    void runAutoRestore(request);
  });
}

/** True to restore now; false to keep waiting or to leave the card. The alarm
 *  must arrive and settle within the window after the Abort, and be seen
 *  settled on two status reports, so a query the app sends after the first one
 *  (its `$G`) is not raced. An alarm that was cleared is over. */
function restoreNow(laser: LaserState, watched: Watched, nowMs: number): boolean {
  const alarmStands = operatorAbortAlarm(laser) === watched.request;
  if (!alarmStands && !watched.alarmSeen) {
    if (nowMs - watched.seenAt > ABORT_AUTO_RESTORE_WINDOW_MS) decided.add(watched.request);
    return false;
  }
  watched.alarmSeen = true;
  const verdict = abortAutoRestoreVerdict(laser, readProfile());
  if (verdict.kind === 'card' || nowMs - watched.seenAt > ABORT_AUTO_RESTORE_WINDOW_MS) {
    decided.add(watched.request);
    return false;
  }
  if (verdict.kind === 'wait') {
    watched.settledSequence = null;
    return false;
  }
  if (watched.settledSequence === null) {
    watched.settledSequence = laser.statusSequence;
    return false;
  }
  return laser.statusSequence > watched.settledSequence;
}

async function runAutoRestore(request: JobStopRequest): Promise<void> {
  // Leave the store update that reached the verdict before commanding
  // anything, then judge once more from the state as it stands.
  await Promise.resolve();
  const verdict = abortAutoRestoreVerdict(useLaserStore.getState(), readProfile());
  if (verdict.kind !== 'restore' || verdict.request !== request) return;
  useAbortAutoRestoreStore.setState({ running: request, failure: null });
  try {
    // The card's own action, without Home and without a rotary turn: Unlock,
    // a fresh Idle report, then one G92. Nothing here moves the head.
    await restoreOriginAfterAbort(verdict.savedMm, false);
    useToastStore.getState().pushToast(ABORT_ORIGIN_RESTORED_MESSAGE, 'info');
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    useAbortAutoRestoreStore.setState({ failure: { request, reason } });
    reportControllerActionFailure(ABORT_AUTO_RESTORE_FAILED_LABEL, error);
  } finally {
    useAbortAutoRestoreStore.setState({ running: null });
  }
}

/** Mounted once with the workspace (App.tsx). */
export function useAbortAutoRestore(): void {
  useEffect(() => installAbortAutoRestore(), []);
}
