import { useEffect } from 'react';
import { sceneObjectHasVisibleLayer } from '../../core/scene';
import { useStore, type AppState } from '../state/store';
import { isSingleTracePart } from '../state/trace-part-geometry';

// History restoration and Select All can select an unsplit trace. While editing
// parts, clear that whole-image selection before keyboard actions can move it.
export function useTracePartSelection(active: boolean): void {
  const invalid = useStore((state) => active && invalidPartSelection(state));
  useEffect(() => {
    if (invalid && invalidPartSelection(useStore.getState())) {
      useStore.getState().selectTracePart(null);
    }
  }, [invalid]);
}

function invalidPartSelection(state: AppState): boolean {
  if (state.pendingUndo !== null) return false;
  return state.project.scene.objects.some(
    (object) =>
      (object.id === state.selectedObjectId || state.additionalSelectedIds.has(object.id)) &&
      (object.locked === true ||
        !isSingleTracePart(object) ||
        !sceneObjectHasVisibleLayer(state.project.scene, object)),
  );
}
