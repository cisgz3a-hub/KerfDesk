import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createScene, type Scene } from '../../core/scene/Scene';

export const sceneStoreInitialScene: Scene = createScene(400, 300, 'Untitled');

export interface SceneStoreState {
  scene: Scene;
}

export interface SceneStoreActions {
  setScene: (scene: Scene) => void;
  resetScene: () => void;
}

export type SceneStore = SceneStoreState & SceneStoreActions;

export function createSceneStore(
  initialScene: Scene = sceneStoreInitialScene,
): UseBoundStore<StoreApi<SceneStore>> {
  return create<SceneStore>((set) => ({
    scene: initialScene,
    setScene: (scene) => set({ scene }),
    resetScene: () => set({ scene: sceneStoreInitialScene }),
  }));
}

export const useSceneStore = createSceneStore();
