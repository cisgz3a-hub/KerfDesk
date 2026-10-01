import type { AppState } from '../state/store';
import type { RemoteAppStore } from './types';

const FIELDS = [
  'project',
  'projectDocumentEpoch',
  'projectOpenRequestEpoch',
  'selectedObjectId',
  'additionalSelectedIds',
  'selectedPathNode',
  'selectedPathNodes',
  'undoStack',
  'redoStack',
  'pendingUndo',
  'layerDefaults',
  'materialLibrary',
  'jobPlacement',
  'outputScopeSettings',
] as const satisfies readonly (keyof AppState)[];

/** Window/session generation prevents reuse across reloads; counter never rewinds on Undo. */
export function createRevisionTracker(store: RemoteAppStore) {
  const generation = crypto.randomUUID();
  let counter = 0;
  const unsubscribe = store.subscribe((state, previous) => {
    if (FIELDS.some((field) => state[field] !== previous[field])) counter += 1;
  });
  return { current: () => `${generation}:${counter}`, dispose: unsubscribe };
}
