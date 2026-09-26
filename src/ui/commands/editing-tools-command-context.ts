// Builds the ADR-410 slice of AppCommandContext (LightBurn gap batch 3) from
// the stores, beside the other per-family context builders.

import type { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import type { CommandShellCallbacks } from './app-command-context-types';
import type { EditingToolsCommandContext } from './editing-tools-command-types';
import { selectionHasUnlockedVectorObject } from './selection-command-state';

export function editingToolsCommandContext(
  app: ReturnType<typeof useStore.getState>,
  callbacks: CommandShellCallbacks,
  selectedIds: ReadonlyArray<string>,
  wireframeActive: boolean,
): EditingToolsCommandContext {
  return {
    pasteInPlace: app.pasteClipboardInPlace,
    invertSelection: app.invertSelection,
    selectOpenShapes: app.selectOpenShapes,
    canOffsetShapes: selectionHasUnlockedVectorObject(app.project, selectedIds),
    offsetShapes: callbacks.requestOffsetShapes,
    rotateSelectionQuarterTurn: app.rotateSelectionQuarterTurn,
    moveSelectionToBed: app.moveSelectionToBed,
    wireframeActive,
    toggleWireframe: () => useUiStore.getState().toggleWireframeView(),
  };
}
