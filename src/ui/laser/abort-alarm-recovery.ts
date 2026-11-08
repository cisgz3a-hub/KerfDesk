// After ABORT JOB on a GRBL-family controller (ADR-341 Amendment 11).
//
// Abort resets the controller at once, so GRBL answers ALARM:3 "Reset during
// motion". The rail used to show that alarm as a fault ("Position is lost.
// Re-home the machine"), even on a machine with no homing, and never said the
// operator had stopped it or that the laser was off. Stock GRBL and FluidNC
// also clear a Set origin here origin (G92) at that reset, and the next Frame
// offered to set the origin wherever the head had stopped. The Alarm 3 card for
// the operator's own Abort says so and puts the saved origin back; only the
// rail's Review recovery did that before. Each action clears the alarm first,
// because a locked controller rejects the G92 (error:9).

import { currentJobStopRequest, currentStreamWasReset } from '../state/job-stop-request';
import type { JobStopRequest } from '../state/job-stop-request';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { waitForControllerStatus } from './frame-status-wait';

export const ABORT_ALARM_NOT_IDLE_MESSAGE =
  'The alarm was cleared, but the controller has not reported Idle yet, so the origin was not ' +
  "changed. Wait a moment, then use Restore saved origin in the interrupted job's Review " +
  'recovery, or Set origin here.';

/** The operator Abort this ALARM:3 answers, or null for any other alarm. The
 *  stored request is returned as is, so a store selector stays stable. */
export function operatorAbortAlarm(
  state: Pick<LaserState, 'alarmCode' | 'jobStopRequest' | 'streamReset' | 'streamerEpoch'>,
): JobStopRequest | null {
  if (state.alarmCode !== 3) return null;
  const request = currentJobStopRequest(state);
  return request?.reason === 'operator' && currentStreamWasReset(state) ? request : null;
}

/** Clear the alarm (Home on a machine with homing, which also measures the
 *  machine again; Unlock otherwise), then write the saved origin back with
 *  one G92. The head moves only for Home. */
export async function restoreOriginAfterAbort(
  savedMm: { readonly x: number; readonly y: number },
  homeFirst: boolean,
): Promise<void> {
  await clearAbortAlarm(homeFirst);
  await useLaserStore.getState().restoreWorkOrigin(savedMm);
}

/** Frame's offer while the saved origin is unrestored and the alarm is
 *  already cleared: Home first on a machine with homing, else write the one
 *  G92 at once (no Unlock: the controller is not locked). */
export async function restoreAbortOriginFromIdle(
  savedMm: { readonly x: number; readonly y: number },
  homeFirst: boolean,
): Promise<void> {
  if (homeFirst) await clearAbortAlarm(true);
  await useLaserStore.getState().restoreWorkOrigin(savedMm);
}

/** Unlock, then set the origin where the head stopped. */
export async function setOriginHereAfterAbort(): Promise<void> {
  await clearAbortAlarm(false);
  await useLaserStore.getState().setOriginHere();
}

async function clearAbortAlarm(home: boolean): Promise<void> {
  const laser = useLaserStore.getState();
  await (home ? laser.home() : laser.unlockAlarm());
  // Unlock and Home both clear the report they replace; the origin write
  // needs a fresh Idle one (ADR-367 Decision 4).
  const idle = await waitForControllerStatus(
    (state) => state.statusReport?.state === 'Idle' && state.controllerOperation === null,
  );
  if (!idle) throw new Error(ABORT_ALARM_NOT_IDLE_MESSAGE);
}
