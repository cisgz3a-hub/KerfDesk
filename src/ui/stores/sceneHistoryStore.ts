import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface HistoryAvailability {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface SceneHistoryState extends HistoryAvailability {
  historyVersion: number;
}

export interface SceneHistoryActions {
  bumpHistoryVersion: () => void;
  setHistoryAvailability: (availability: HistoryAvailability) => void;
  resetSceneHistory: () => void;
}

export type SceneHistoryStore = SceneHistoryState & SceneHistoryActions;

export const sceneHistoryInitialState: SceneHistoryState = {
  historyVersion: 0,
  canUndo: false,
  canRedo: false,
};

export function createSceneHistoryStore(): UseBoundStore<StoreApi<SceneHistoryStore>> {
  return create<SceneHistoryStore>((set) => ({
    ...sceneHistoryInitialState,
    bumpHistoryVersion: () => set(state => ({ historyVersion: state.historyVersion + 1 })),
    setHistoryAvailability: (availability) => set({
      canUndo: availability.canUndo,
      canRedo: availability.canRedo,
    }),
    resetSceneHistory: () => set(sceneHistoryInitialState),
  }));
}

export const useSceneHistoryStore = createSceneHistoryStore();
