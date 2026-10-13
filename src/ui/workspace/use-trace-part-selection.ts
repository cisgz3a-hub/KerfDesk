import { useEffect } from 'react';
import { sceneObjectHasVisibleLayer } from '../../core/scene';
import { useStore, type AppState } from '../state/store';
import { useUiStore } from '../state/ui-store';
import {
  cancelTracePartPreparation,
  ensureTracePartSceneReady,
  isPreparedSingleTracePart,
} from './trace-part-preparation';

// History restoration and Select All can select an unsplit trace. While editing
// parts, clear that whole-image selection before keyboard actions can move it.
export function useTracePartSelection(active: boolean): void {
  const scene = useStore((state) => (active ? state.project.scene : null));
  const epoch = useStore((state) => (active ? state.projectDocumentEpoch : 0));
  useEffect(() => {
    if (scene !== null) ensureTracePartSceneReady(scene, epoch);
    else cancelTracePartPreparation();
    return cancelTracePartPreparation;
  }, [active, scene, epoch]);
  const invalid = useStore((state) => active && invalidPartSelection(state));
  useEffect(() => {
    if (invalid && invalidPartSelection(useStore.getState())) {
      useStore.getState().selectTracePart(null);
      useUiStore.getState().closeWorkspaceContextBar();
    }
  }, [invalid]);
}

function invalidPartSelection(state: AppState): boolean {
  if (state.pendingUndo !== null) return false;
  return state.project.scene.objects.some(
    (object) =>
      (object.id === state.selectedObjectId || state.additionalSelectedIds.has(object.id)) &&
      (object.locked === true ||
        !isPreparedSingleTracePart(object, state.project.scene.layers) ||
        !sceneObjectHasVisibleLayer(state.project.scene, object)),
  );
}
