// useFramedRunLaserState — the laser-store snapshot the machine rail's setup
// row reads: the permit itself plus every field
// controllerStartPreparationStillCurrent compares when framedRunReadinessIssue
// decides whether the Frame is still current.
//
// The row used to subscribe to the whole laser store, so the per-ack streamer
// replacement re-rendered it once per streamed G-code line during a burn.
// controllerSettings / controllerSettingsObservation / controllerBuildInfo are
// deliberately absent: framedRunReadinessIssue passes
// ignoreAdvisoryControllerEvidence, so a post-Frame $30/$32 or $I refresh does
// not change its answer (ADR-232).

import { useStoreWithEqualityFn } from 'zustand/traditional';
import { selectWholeState, watchedFieldsEqual } from '../state';
import { useLaserStore } from '../state/laser-store';

type LaserState = ReturnType<typeof useLaserStore.getState>;

const FRAMED_RUN_FIELDS = [
  'framedRun',
  'motionOperation',
  'statusReport',
  'wcoCache',
  'workOriginActive',
  'workOriginSource',
  'trustedPositionEpoch',
  'workZReferenceEpoch',
  'workZZeroEvidence',
  'controllerSessionEpoch',
] as const;

const framedRunFieldsEqual = watchedFieldsEqual<LaserState, (typeof FRAMED_RUN_FIELDS)[number]>(
  FRAMED_RUN_FIELDS,
);

export function useFramedRunLaserState(): LaserState {
  return useStoreWithEqualityFn(useLaserStore, selectWholeState, framedRunFieldsEqual);
}
