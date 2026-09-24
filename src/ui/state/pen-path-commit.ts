// pen-path-commit — apply a finished pen path as one undoable edit (ADR-380).
// A new drawing goes through drawShape like every drawn shape; an extended or
// joined path replaces its objects in place, keeping their stacking order, and
// becomes the selection.

import { removeObject, replaceObject, type Scene, type ShapeObject } from '../../core/scene';
import type { PenCommitPlan } from './pen-path-join';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import { useStore } from './store';

export function commitPenPlan(plan: PenCommitPlan, drawShape: (shape: ShapeObject) => void): void {
  if (plan.kind === 'new-shape') {
    drawShape(plan.shape);
    return;
  }
  useStore.setState((state) => ({
    project: { ...state.project, scene: applyReplacements(state.project.scene, plan.replacements) },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
    selectedObjectId: plan.selectId,
    additionalSelectedIds: new Set<string>(),
    selectedPathNode: null,
    selectedPathNodes: [],
  }));
}

function applyReplacements(
  scene: Scene,
  replacements: Extract<PenCommitPlan, { readonly kind: 'merge' }>['replacements'],
): Scene {
  let next = scene;
  const removed = new Set<string>();
  for (const [id, object] of replacements) {
    if (object === null) {
      removed.add(id);
      next = removeObject(next, id);
    } else {
      next = replaceObject(next, id, object);
    }
  }
  return removed.size === 0 ? next : pruneOrphanLayers(removeObjectIdsFromGroups(next, removed));
}
