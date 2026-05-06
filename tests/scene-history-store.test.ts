import {
  createSceneHistoryStore,
  sceneHistoryInitialState,
} from '../src/ui/stores/sceneHistoryStore';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

{
  const store = createSceneHistoryStore();
  const state = store.getState();
  assert(state.historyVersion === 0, 'history version starts at zero');
  assert(state.canUndo === false, 'canUndo starts false');
  assert(state.canRedo === false, 'canRedo starts false');
}

{
  const store = createSceneHistoryStore();
  store.getState().bumpHistoryVersion();
  store.getState().bumpHistoryVersion();
  assert(store.getState().historyVersion === 2, 'history version increments');

  store.getState().setHistoryAvailability({ canUndo: true, canRedo: false });
  assert(store.getState().canUndo === true, 'canUndo updates');
  assert(store.getState().canRedo === false, 'canRedo updates false');

  store.getState().setHistoryAvailability({ canUndo: true, canRedo: true });
  assert(store.getState().canRedo === true, 'canRedo updates true');

  store.getState().resetSceneHistory();
  assert(store.getState().historyVersion === sceneHistoryInitialState.historyVersion, 'reset restores history version');
  assert(store.getState().canUndo === sceneHistoryInitialState.canUndo, 'reset restores canUndo');
  assert(store.getState().canRedo === sceneHistoryInitialState.canRedo, 'reset restores canRedo');
}
