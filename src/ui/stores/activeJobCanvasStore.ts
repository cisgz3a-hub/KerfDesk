import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { type MachineTransformResult } from '../../core/plan/MachineTransform';
import { type Move } from '../../core/plan/Plan';

export interface MachinePlanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ActiveJobCanvasState {
  activeJobMoves: readonly Move[] | null;
  activeJobPlanBounds: MachinePlanBounds | null;
  activeJobTransform: MachineTransformResult | null;
}

export interface ActiveJobCanvasActions {
  setActiveJobCanvasContext: (context: {
    moves: readonly Move[];
    planBounds: MachinePlanBounds;
    transform: MachineTransformResult;
  }) => void;
  clearActiveJobCanvasContext: () => void;
  resetActiveJobCanvas: () => void;
}

export type ActiveJobCanvasStore = ActiveJobCanvasState & ActiveJobCanvasActions;

export const activeJobCanvasInitialState: ActiveJobCanvasState = {
  activeJobMoves: null,
  activeJobPlanBounds: null,
  activeJobTransform: null,
};

export function createActiveJobCanvasStore(): UseBoundStore<StoreApi<ActiveJobCanvasStore>> {
  return create<ActiveJobCanvasStore>((set) => ({
    ...activeJobCanvasInitialState,
    setActiveJobCanvasContext: ({ moves, planBounds, transform }) => set({
      activeJobMoves: moves,
      activeJobPlanBounds: planBounds,
      activeJobTransform: transform,
    }),
    clearActiveJobCanvasContext: () => set(activeJobCanvasInitialState),
    resetActiveJobCanvas: () => set(activeJobCanvasInitialState),
  }));
}

export const useActiveJobCanvasStore = createActiveJobCanvasStore();
