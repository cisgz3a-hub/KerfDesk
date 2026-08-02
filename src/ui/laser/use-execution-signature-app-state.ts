// useExecutionSignatureAppState — the app-store snapshot the execution
// signature is derived from (project, output scope, placement, registration).
//
// The Run-again offer and the machine rail's framed-run status both recompute
// that signature on every render and both used to subscribe to the whole app
// store, so a plain mousemove's setCursorMm re-ran them. Watching only the
// inputs of currentReplayExecutionSignature keeps the comparison exact while
// leaving both surfaces idle during pointer motion.

import { useStoreWithEqualityFn } from 'zustand/traditional';
import { selectWholeState, useStore, watchedFieldsEqual } from '../state';

type AppState = ReturnType<typeof useStore.getState>;

const SIGNATURE_FIELDS = [
  'project',
  'outputScopeSettings',
  'selectedObjectId',
  'additionalSelectedIds',
  'jobPlacement',
] as const;

const signatureFieldsEqual = watchedFieldsEqual<AppState, (typeof SIGNATURE_FIELDS)[number]>(
  SIGNATURE_FIELDS,
);

export function useExecutionSignatureAppState(): AppState {
  return useStoreWithEqualityFn(useStore, selectWholeState, signatureFieldsEqual);
}
