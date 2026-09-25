// A completed Frame belongs to the machine it was traced on (PROJECT.md
// non-negotiable 21, ADRs 228/230/232/237). Switching machines ends it even
// when both profiles would compile the same program, because the outline was
// checked against another machine's bed, origin and output settings.

import { noteFrameExpired } from '../laser/frame-expiry-note';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';

type LaserSnapshot = ReturnType<typeof useLaserStore.getState>;

export function frameEvidencePresent(laser: LaserSnapshot = useLaserStore.getState()): boolean {
  return (
    laser.framedRun !== null ||
    (laser.frameTrace ?? null) !== null ||
    laser.frameVerification !== null
  );
}

/** Call with what `frameEvidencePresent` said before the machine changed, so
 * Start explains the new Frame even when the automatic expiry got there first. */
export function expireFrameAfterMachineChange(machineName: string, hadFrame: boolean): void {
  useLaserStore.setState({ framedRun: null, frameTrace: null, frameVerification: null });
  if (hadFrame) noteFrameExpired(`The machine changed to “${machineName}” after Frame.`);
}

/** Why the open project's machine cannot change right now, or null. */
export function machineChangeBlocker(
  laser: LaserSnapshot = useLaserStore.getState(),
): string | null {
  if (isActiveJob(laser.streamer)) {
    return 'A job is running. Stop it or let it finish before switching machines.';
  }
  if (laser.framedRunStartClaim !== null) {
    return 'Start is handing the job to the controller. Wait for it before switching machines.';
  }
  if (laser.motionOperation !== null || laser.autofocusBusy || laser.probeBusy) {
    return 'The machine is moving. Wait for it to stop before switching machines.';
  }
  if (laser.fireActive) return 'Test fire is on. Turn it off before switching machines.';
  return null;
}
