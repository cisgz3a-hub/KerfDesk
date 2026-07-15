// draw-shape-mutation — commit a freshly drawn kind:'shape' object into the
// scene (ADR-051, Phase G, B5). Mirrors applyUpsertText's add path but skips
// fit-to-bed: a drawn shape is already placed where the user dragged it. New
// shapes land on a line (cut) layer for their colour — LightBurn's default for
// drawn vectors — auto-created on demand if the colour has no layer yet.

import { addLayer, addObject, createArtworkOperation, type ShapeObject } from '../../core/scene';
import { type MutationResult, pushUndo, type StateSlice } from './scene-mutations';

export function applyDrawShape(
  s: StateSlice,
  shape: ShapeObject,
): MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> } {
  const created = createArtworkOperation(s.project.scene, shape);
  const scene = addLayer(addObject(s.project.scene, created.object), created.operation);
  return {
    project: { ...s.project, scene },
    selectedObjectId: shape.id,
    // A drawn shape is the sole selection — clear any prior multi-select so
    // Delete / duplicate can't act on a stale ghost set (matches applyFreshImport).
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}
