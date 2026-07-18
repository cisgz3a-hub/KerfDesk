import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';

const FRAME_POSITION_TIMEOUT_MS = 3_000;
const FRAME_POSITION_POLL_MS = 25;

/** Wait for the post-setup position sample rather than binding Frame to the
 * stale WPos that existed before a guided Zero-Z command. */
export async function waitForFreshIdleFramePosition(afterSequence: number): Promise<boolean> {
  const deadline = Date.now() + FRAME_POSITION_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (hasFreshIdleFramePosition(useLaserStore.getState(), afterSequence)) return true;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, FRAME_POSITION_POLL_MS);
    });
  }
  return false;
}

export function hasFreshIdleFramePosition(
  laser: Pick<
    ReturnType<typeof useLaserStore.getState>,
    'statusSequence' | 'statusReport' | 'wcoCache' | 'workOriginActive' | 'controllerSettings'
  >,
  afterSequence: number,
): boolean {
  return (
    laser.statusSequence > afterSequence &&
    laser.statusReport?.state === 'Idle' &&
    reportedWorkPositionMm(laser, laser.controllerSettings?.reportInches === true) !== null
  );
}
