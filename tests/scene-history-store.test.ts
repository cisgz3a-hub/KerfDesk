import {
  createSceneHistoryStore,
  sceneHistoryInitialState,
} from '../src/ui/stores/sceneHistoryStore';
import { createScene } from '../src/core/scene/Scene';

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

{
  const store = createSceneHistoryStore();
  const first = createScene();
  const second = { ...first, metadata: { ...first.metadata, name: 'second' } };

  store.getState().resetHistory(first, { action: 'init' });
  assert(store.getState().canUndo === false, 'resetHistory seeds a clean baseline');

  store.getState().pushHistory(second, { action: 'rename' });
  assert(store.getState().canUndo === true, 'pushHistory updates canUndo');
  assert(store.getState().canRedo === false, 'pushHistory clears canRedo');

  const undo = store.getState().undoHistoryEntry();
  assert(undo?.scene === first, 'undoHistoryEntry returns the previous scene entry');
  assert(store.getState().canUndo === false, 'undoHistoryEntry updates canUndo');
  assert(store.getState().canRedo === true, 'undoHistoryEntry updates canRedo');

  const redo = store.getState().redoHistoryEntry();
  assert(redo?.scene === second, 'redoHistoryEntry returns the next scene entry');
  assert(store.getState().canUndo === true, 'redoHistoryEntry restores canUndo');
  assert(store.getState().canRedo === false, 'redoHistoryEntry updates canRedo');
}
