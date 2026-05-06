import {
  activeJobCanvasInitialState,
  createActiveJobCanvasStore,
} from '../src/ui/stores/activeJobCanvasStore';
import { type Move } from '../src/core/plan/Plan';
import { type MachineTransformResult } from '../src/core/plan/MachineTransform';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const moves = [{ type: 'rapid', x: 1, y: 2 }] as unknown as readonly Move[];
const bounds = { minX: 1, minY: 2, maxX: 3, maxY: 4 };
const transform = {
  offsetX: 10,
  offsetY: 20,
  flipY: true,
  flipReferenceY: 400,
  plan: { bounds },
} as unknown as MachineTransformResult;

{
  const store = createActiveJobCanvasStore();
  const state = store.getState();
  assert(state.activeJobMoves === null, 'active job moves start empty');
  assert(state.activeJobPlanBounds === null, 'active job bounds start empty');
  assert(state.activeJobTransform === null, 'active job transform starts empty');
}

{
  const store = createActiveJobCanvasStore();
  store.getState().setActiveJobCanvasContext({
    moves,
    planBounds: bounds,
    transform,
  });

  assert(store.getState().activeJobMoves === moves, 'active job moves preserve compile-time reference');
  assert(store.getState().activeJobPlanBounds === bounds, 'active job bounds preserve compile-time reference');
  assert(store.getState().activeJobTransform === transform, 'active job transform preserves compile-time reference');

  store.getState().clearActiveJobCanvasContext();
  assert(store.getState().activeJobMoves === null, 'clear removes active job moves');
  assert(store.getState().activeJobPlanBounds === null, 'clear removes active job bounds');
  assert(store.getState().activeJobTransform === null, 'clear removes active job transform');
}

{
  const store = createActiveJobCanvasStore();
  store.getState().setActiveJobCanvasContext({ moves, planBounds: bounds, transform });
  store.getState().resetActiveJobCanvas();
  assert(store.getState().activeJobMoves === activeJobCanvasInitialState.activeJobMoves, 'reset restores moves');
  assert(store.getState().activeJobPlanBounds === activeJobCanvasInitialState.activeJobPlanBounds, 'reset restores bounds');
  assert(store.getState().activeJobTransform === activeJobCanvasInitialState.activeJobTransform, 'reset restores transform');
}
