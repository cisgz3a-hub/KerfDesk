// Beam-off move to a point of an interrupted job's work coordinates (ADR-341
// Amendment 8), through the same jog as Go to work zero: the machine target is
// the controller's reported work offset plus the point.

import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import { useStore } from '../state';
import { reportedWorkOffsetMm } from '../state/infer-machine-position';
import { useLaserStore } from '../state/laser-store';
import { clampJogFeed } from './jog-control-policy';
import { useJogControlPreferences } from './jog-control-preferences';

export async function moveHeadToWorkPoint(pointMm: {
  readonly x: number;
  readonly y: number;
}): Promise<void> {
  const laser = useLaserStore.getState();
  const offsetMm = reportedWorkOffsetMm(
    laser.wcoCache,
    laser.controllerSettings?.reportInches === true,
  );
  if (offsetMm === null) {
    throw new Error(
      'The controller has not reported its work origin yet. Wait for a position report.',
    );
  }
  const { device, machine } = useStore.getState().project;
  const feed = clampJogFeed(
    useJogControlPreferences.getState().requestedFeedMmPerMin,
    deviceForActiveHead(device, machine).maxFeed,
  );
  await laser.jogToMachinePosition(offsetMm.x + pointMm.x, offsetMm.y + pointMm.y, feed);
}
