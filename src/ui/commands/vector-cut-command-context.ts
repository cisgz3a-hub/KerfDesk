// Builds the Trim Shapes and Cut Shapes slice of AppCommandContext (LBG-T04,
// LBG-T08). useAppCommands re-renders on every tool change, so reading the
// tool mode here keeps the menu check mark current.

import { useUiStore } from '../state/ui-store';
import { cutShapesInBackground } from './vector-background-commands';
import type { VectorCutCommandContext } from './vector-cut-command-types';

export function vectorCutCommandContext(): VectorCutCommandContext {
  return {
    trimShapesActive: useUiStore.getState().toolMode.kind === 'trim-shapes',
    trimShapes: () => {
      const ui = useUiStore.getState();
      if (ui.toolMode.kind === 'trim-shapes') ui.resetToolMode();
      else ui.setToolMode({ kind: 'trim-shapes' });
    },
    extendShapesActive: useUiStore.getState().toolMode.kind === 'extend-shapes',
    extendShapes: () => {
      const ui = useUiStore.getState();
      if (ui.toolMode.kind === 'extend-shapes') ui.resetToolMode();
      else ui.setToolMode({ kind: 'extend-shapes' });
    },
    // The cut runs in the vector worker and commits when it settles (ADR-609).
    cutShapes: () => void cutShapesInBackground(),
  };
}
