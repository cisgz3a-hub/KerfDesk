import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { type Scene } from '../../core/scene/Scene';
import {
  HistoryManager,
  type HistoryEntry,
  type HistoryEntryMeta,
} from '../history/HistoryManager';

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
  pushHistory: (scene: Scene, meta?: HistoryEntryMeta) => void;
  resetHistory: (scene: Scene, meta?: HistoryEntryMeta) => void;
  undoHistoryEntry: () => HistoryEntry | null;
  redoHistoryEntry: () => HistoryEntry | null;
  resetSceneHistory: () => void;
}

export type SceneHistoryStore = SceneHistoryState & SceneHistoryActions;

export const sceneHistoryInitialState: SceneHistoryState = {
  historyVersion: 0,
  canUndo: false,
  canRedo: false,
};

export function createSceneHistoryStore(
  history: HistoryManager = new HistoryManager(),
): UseBoundStore<StoreApi<SceneHistoryStore>> {
  return create<SceneHistoryStore>((set) => {
    const syncAvailability = () => {
      set({
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      });
    };

    return {
      ...sceneHistoryInitialState,
      bumpHistoryVersion: () => set(state => ({ historyVersion: state.historyVersion + 1 })),
      setHistoryAvailability: (availability) => set({
        canUndo: availability.canUndo,
        canRedo: availability.canRedo,
      }),
      pushHistory: (scene, meta) => {
        history.push(scene, meta);
        syncAvailability();
      },
      resetHistory: (scene, meta) => {
        history.reset(scene, meta);
        syncAvailability();
      },
      undoHistoryEntry: () => {
        const entry = history.undoEntry();
        syncAvailability();
        return entry;
      },
      redoHistoryEntry: () => {
        const entry = history.redoEntry();
        syncAvailability();
        return entry;
      },
      resetSceneHistory: () => {
        history.clear();
        set(sceneHistoryInitialState);
      },
    };
  });
}

export const useSceneHistoryStore = createSceneHistoryStore();
