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

const allFieldsEqual = watchedFieldsEqual<LaserState, (typeof FRAMED_RUN_FIELDS)[number]>(
  FRAMED_RUN_FIELDS,
);
const fieldsBesideReportEqual = watchedFieldsEqual<LaserState, (typeof FRAMED_RUN_FIELDS)[number]>(
  FRAMED_RUN_FIELDS.filter((field) => field !== 'statusReport'),
);

// Without a permit the readiness answer is fixed (Frame first) and the row
// reads only the controller state from the report, so a poll that merely moves
// the head, four a second for a whole job, need not re-render it (ADR-352).
export function framedRunFieldsEqual(a: LaserState, b: LaserState): boolean {
  if (a === b) return true;
  if (a.framedRun !== null || b.framedRun !== null) return allFieldsEqual(a, b);
  return (
    (a.statusReport?.state ?? null) === (b.statusReport?.state ?? null) &&
    fieldsBesideReportEqual(a, b)
  );
}

export function useFramedRunLaserState(): LaserState {
  return useStoreWithEqualityFn(useLaserStore, selectWholeState, framedRunFieldsEqual);
}
