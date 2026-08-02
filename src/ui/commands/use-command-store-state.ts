// useCommandStoreState — the app + laser snapshots the always-mounted command
// surface reads while it builds the command list.
//
// useAppCommands used to subscribe to both stores whole, so EVERY store write
// rebuilt the command array and re-rendered the menu bar, toolbar and context
// bar: setCursorMm at mousemove cadence, the 250 ms status-report poll, and the
// per-ack streamer replacement during a burn. The field lists below are exactly
// what the command context reads while rendering; everything an action needs at
// click time (jobPlacement, output scope, the live controller observation) is
// read fresh from getState() inside that action instead.

import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { selectWholeState, watchedFieldsEqual } from '../state/watched-fields-equal';

type AppState = ReturnType<typeof useStore.getState>;
type LaserState = ReturnType<typeof useLaserStore.getState>;

const APP_FIELDS = [
  'project',
  'selectedObjectId',
  'additionalSelectedIds',
  'sceneClipboard',
  'previewMode',
  'dirty',
  'savedName',
  'undoStack',
  'redoStack',
] as const;

const LASER_FIELDS = [
  'connection',
  'autofocusBusy',
  'motionOperation',
  'controllerOperation',
] as const;

const appFieldsEqual = watchedFieldsEqual<AppState, (typeof APP_FIELDS)[number]>(APP_FIELDS);
const laserFieldsEqual = watchedFieldsEqual<LaserState, (typeof LASER_FIELDS)[number]>(
  LASER_FIELDS,
);

// Only the streamer's STATUS decides whether job-active commands are available.
// Its completed/total counters advance once per controller ack, which must not
// rebuild the command list mid-burn.
function laserStateEqual(a: LaserState, b: LaserState): boolean {
  return laserFieldsEqual(a, b) && a.streamer?.status === b.streamer?.status;
}

export function useCommandStoreState(): {
  readonly app: AppState;
  readonly laser: LaserState;
} {
  return {
    app: useStoreWithEqualityFn(useStore, selectWholeState, appFieldsEqual),
    laser: useStoreWithEqualityFn(useLaserStore, selectWholeState, laserStateEqual),
  };
}
