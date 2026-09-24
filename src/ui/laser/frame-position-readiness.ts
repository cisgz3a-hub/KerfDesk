import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';
import { resolveJobPlacement, type JobPlacementSettings } from '../job-placement';

const FRAME_POSITION_TIMEOUT_MS = 3_000;
const FRAME_POSITION_POLL_MS = 25;
const FRAME_OFFSET_QUERY_MS = 100;

/** Home settles before its first unsuppressed offset report. Let that report
 * arrive before capturing compilation inputs; never clear a real work origin. */
export async function waitForAbsoluteFrameOffset(
  placement: JobPlacementSettings,
): Promise<boolean> {
  const before = useLaserStore.getState();
  if (placement.startFrom !== 'absolute') return true;
  if (!needsAbsoluteFrameOffset(before, placement)) return true;
  const deadline = Date.now() + FRAME_POSITION_TIMEOUT_MS;
  let nextQuery = Date.now();
  while (Date.now() <= deadline) {
    const current = useLaserStore.getState();
    if (
      current.controllerSessionEpoch !== before.controllerSessionEpoch ||
      current.trustedPositionEpoch !== before.trustedPositionEpoch
    )
      return false;
    if (
      hasFreshIdleFramePosition(current, before.statusSequence) &&
      current.wcoCache !== null &&
      resolveJobPlacement(placement, current).ok
    )
      return true;
    // WCO is intermittent. A short burst of ordinary status queries obtains
    // that field without waiting ten idle polling periods or changing offsets.
    if (Date.now() >= nextQuery) {
      void current.requestControllerStatus();
      nextQuery = Date.now() + FRAME_OFFSET_QUERY_MS;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, FRAME_POSITION_POLL_MS);
    });
  }
  return false;
}

function needsAbsoluteFrameOffset(
  laser: ReturnType<typeof useLaserStore.getState>,
  placement: JobPlacementSettings,
): boolean {
  return (
    (laser.homingState === 'confirmed' &&
      laser.capabilities.wcs === 'g92-and-g10' &&
      laser.wcoCache === null) ||
    !resolveJobPlacement(placement, laser).ok
  );
}

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
