import {
  createSceneStore,
  sceneStoreInitialScene,
} from '../src/ui/stores/sceneStore';
import { createScene } from '../src/core/scene/Scene';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

{
  const store = createSceneStore();
  const state = store.getState();
  assert(state.scene.metadata.name === 'Untitled', 'scene starts with Untitled name');
  assert(state.scene.canvas.width === 400, 'scene starts with 400mm width');
  assert(state.scene.canvas.height === 300, 'scene starts with 300mm height');
}

{
  const store = createSceneStore();
  const next = createScene(100, 80, 'Next Scene');
  store.getState().setScene(next);
  assert(store.getState().scene === next, 'setScene preserves scene reference');

  store.getState().resetScene();
  assert(store.getState().scene.metadata.name === sceneStoreInitialScene.metadata.name, 'reset restores initial scene name');
  assert(store.getState().scene.canvas.width === sceneStoreInitialScene.canvas.width, 'reset restores initial scene width');
  assert(store.getState().scene.canvas.height === sceneStoreInitialScene.canvas.height, 'reset restores initial scene height');
}
