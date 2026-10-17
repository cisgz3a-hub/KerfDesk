// Offset outlines and Cut Shapes, computed in the vector worker (ADR-609).
// A selection the action refuses outright (nothing eligible, locked, a live
// compound, too few shapes) goes straight to the action, which explains why
// at once; only real geometry work goes to the worker.

import { isVectorPathObject, type VectorSceneObject } from '../../core/geometry';
import { isUnlockedVectorArtwork } from '../../core/geometry/trim-contours';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import { useStore } from '../state';
import { cutShapesSelection, cutShapesUsedIds } from '../state/cut-shapes-actions';
import { selectedObjectIds } from '../state/scene-group-actions';
import { uniqueObjectId } from '../state/vector-path-selection';
import { runVectorCommandInBackground } from './background-vector-command';

/** The Offset outlines row: a new outline `deltaMm` outside (or, negative, inside). */
export function offsetOutlinesInBackground(deltaMm: number): Promise<boolean> {
  const state = useStore.getState();
  const scene = state.project.scene;
  const ids = new Set(selectedObjectIds(state));
  const sources = scene.objects.filter(
    (object): object is VectorSceneObject => ids.has(object.id) && isVectorPathObject(object),
  );
  const refused =
    sources.length === 0 ||
    sources.some((object) => object.locked === true || isBooleanCompoundObject(object));
  if (refused) {
    state.offsetSelection(deltaMm);
    return Promise.resolve(true);
  }
  const id = uniqueObjectId(scene, 'offset');
  return runVectorCommandInBackground({
    label: 'Offset outlines',
    sources,
    task: { kind: 'offset-paths', deltaMm, id },
    commit: (result) =>
      useStore.getState().offsetSelection(deltaMm, { sources, deltaMm, id, result }),
    inThread: () => useStore.getState().offsetSelection(deltaMm),
  });
}

export function cutShapesInBackground(): Promise<boolean> {
  const state = useStore.getState();
  const scene = state.project.scene;
  const sources = cutShapesSelection(scene, selectedObjectIds(state)).filter(
    isUnlockedVectorArtwork,
  );
  if (sources.length < 2) {
    state.cutSelectedShapes();
    return Promise.resolve(true);
  }
  return runVectorCommandInBackground({
    label: 'Cut Shapes',
    sources,
    task: { kind: 'cut-shapes', usedIds: [...cutShapesUsedIds(scene)] },
    commit: (result) => useStore.getState().cutSelectedShapes({ scene, sources, result }),
    inThread: () => useStore.getState().cutSelectedShapes(),
  });
}
