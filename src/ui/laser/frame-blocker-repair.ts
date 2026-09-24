// In-place fixes before an ordinary Frame (maintainer, 2026-07-17: blocks ask
// to fix in place, not dead-end in an alert; ADR-364). Start with no permit
// runs this same Frame, so both buttons reach them. The offers used to be
// reachable only from the checkpoint Start flow, so a plain Frame or Start
// answered an alarm or a missing origin with a red refusal and nothing else.
//
// Nothing here adds a refusal. Each step either clears a condition the Frame
// would refuse for, or leaves it to be refused with the Frame's own messages,
// so every factual gate still runs after the repair.

import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { resolveLiveFramePlacement } from './camera-frame-placement';
import { reportFrameRefusal } from './frame-dispatch-support';
import { hasFreshIdleFramePosition } from './frame-position-readiness';
import { waitForControllerStatus } from './frame-status-wait';
import { isAlarmRefusalMessage, offerAlarmFixForBlockedStart } from './start-blocked-alarm-offers';
import { offerSetupFixForBlockedStart } from './start-blocked-setup-offers';
import { findMachineStartIssues } from './start-job-input';
import { machineSnapshot } from './start-machine-snapshot';

/** Resolves false when the Frame stops here: an accepted repair left the next
 * step to the operator (its toast says which), or an alarm still stands and
 * has been reported. True lets the Frame proceed to its ordinary gates. */
export async function offerFrameBlockerFixes(): Promise<boolean> {
  await waitForControllerStatus((laser) => laser.statusReport !== null);
  const machineIssues = currentMachineIssues();
  if (machineIssues.length > 0) {
    // Alarm is the one machine block with an in-place fix. Motion still
    // running, a hold, or autofocus is reported by the ordinary refusal.
    const repair = await offerAlarmFixForBlockedStart(machineIssues);
    if (repair === 'handled') return false;
    if (repair === 'unrepaired') return !reportedStandingAlarm();
    // One offer per press, as the checkpoint Start allows: after Home the head
    // sits at the switches, so a missing origin is reported for the operator
    // to position and set, never set here.
    await waitForPostRepairPosition();
    return true;
  }
  await waitForControllerStatus(placementNotWaitingOnOffset);
  const refusal = soleLivePlacementRefusal();
  if (refusal === null) return true;
  const repair = await offerSetupFixForBlockedStart(refusal);
  if (repair === 'retry') await waitForPostRepairPosition();
  return repair !== 'handled';
}

// An alarm left standing (the fix declined, unavailable or failed, or offered
// none because another machine blocker stands beside it) is refused now with
// the machine messages the Start preparation reports, before the G54
// selection or CNC Zero Z step reaches a controller that rejects commands in
// Alarm.
function reportedStandingAlarm(): boolean {
  const machineIssues = currentMachineIssues();
  if (!machineIssues.some(isAlarmRefusalMessage)) return false;
  reportFrameRefusal(machineIssues);
  return true;
}

function currentMachineIssues(): ReadonlyArray<string> {
  return findMachineStartIssues(
    machineSnapshot(
      useStore.getState().project,
      useLaserStore.getState(),
      useCameraStore.getState(),
    ),
  );
}

// The report on hand when a repair returns predates it: Home strips positions
// until it settles, and a status from before Set origin still carries the old
// work offset, which would bind the Frame's return point to the wrong place.
// Wait for a report taken after the repair; if none comes, the Frame's own
// position checks refuse as they always have.
async function waitForPostRepairPosition(): Promise<void> {
  const afterSequence = useLaserStore.getState().statusSequence;
  await waitForControllerStatus((laser) => hasFreshIdleFramePosition(laser, afterSequence));
}

// A placement that refuses while the controller has not reported its offset
// may resolve once it does (a persistent G54 origin surfacing after a
// reconnect, or the offset of an origin set before Home). A known offset, or a
// placement that already resolves, needs no wait.
function placementNotWaitingOnOffset(laser: LaserState): boolean {
  if (laser.wcoCache !== null || (laser.statusReport?.wco ?? null) !== null) return true;
  return resolveLiveFramePlacement(useStore.getState(), laser).ok;
}

function soleLivePlacementRefusal(): string | null {
  const placement = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
  if (placement.ok || placement.messages.length !== 1) return null;
  return placement.messages[0] ?? null;
}
