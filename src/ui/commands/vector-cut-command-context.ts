// Builds the Trim Shapes and Cut Shapes slice of AppCommandContext (LBG-T04,
// LBG-T08). useAppCommands re-renders on every tool change, so reading the
// tool mode here keeps the menu check mark current.

import type { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import type { VectorCutCommandContext } from './vector-cut-command-types';

export function vectorCutCommandContext(
  app: ReturnType<typeof useStore.getState>,
): VectorCutCommandContext {
  return {
    trimShapesActive: useUiStore.getState().toolMode.kind === 'trim-shapes',
    trimShapes: () => {
      const ui = useUiStore.getState();
      if (ui.toolMode.kind === 'trim-shapes') ui.resetToolMode();
      else ui.setToolMode({ kind: 'trim-shapes' });
    },
    cutShapes: () => {
      app.cutSelectedShapes();
    },
  };
}
