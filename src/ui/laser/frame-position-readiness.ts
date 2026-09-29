import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { useLaserStore, type LaserState } from '../state/laser-store';
import {
  placementAssumesZeroWorkOffset,
  resolveJobPlacement,
  type JobPlacementSettings,
} from '../job-placement';
import { waitForControllerStatus } from './frame-status-wait';
import { controllerReportsWorkOffset } from './work-offset-assumption';

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

/** GRBL puts WCO in only some status reports, so a Frame pressed soon after
 * connecting or a reset can find none yet, homed or not, and Absolute or
 * Current Position would be placed at an assumed zero offset. Its jog targets
 * are work coordinates, so a real offset would shift the trace (ADR-375). Ask
 * for the offset with the same bounded status burst. Never a refusal: when no
 * WCO arrives the Frame continues as before and Job Review says what was
 * assumed (work-offset-assumption).
 * https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/jogging.md#L23 */
export async function waitForUnreportedFrameWorkOffset(
  placement: JobPlacementSettings,
): Promise<void> {
  await waitForControllerStatus((laser) => !awaitsReportedWorkOffset(laser, placement));
}

function awaitsReportedWorkOffset(laser: LaserState, placement: JobPlacementSettings): boolean {
  return (
    controllerReportsWorkOffset(laser.capabilities) &&
    // While position evidence is suppressed the store discards WCO as well
    // (statusPositionPatch), so no report could end the wait.
    laser.positionEvidenceSuppressed !== true &&
    laser.reportUnitsUnconfirmed !== true &&
    placementAssumesZeroWorkOffset(placement.startFrom, laser)
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
