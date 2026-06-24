// registration-box-actions — insert (or replace) the locked registration jig box
// on the reserved registration layer (ADR-057). Distinct from applyDrawShape for
// two reasons: the box must land on the reserved id='registration' layer
// (createRegistrationLayer), NOT the color-keyed layer ensureLayersForColors would
// create; and only ONE jig may exist, because two boxes would make the
// box-anchored placement span both (combinedBBox).

import {
  addLayer,
  addObject,
  createRegistrationLayer,
  findRegistrationBoxes,
  findRegistrationLayer,
  type Project,
  REGISTRATION_LAYER_ID,
  removeObject,
  type ShapeObject,
} from '../../core/scene';
import { type MutationResult, pushUndo, type StateSlice } from './scene-mutations';

type RemoveRegistrationBoxResult = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

export function registrationBoxDefaultPosition(
  bedWidth: number,
  bedHeight: number,
  widthMm: number,
  heightMm: number,
): { readonly x: number; readonly y: number } {
  // Centered on the bed: most visible, with room on all sides to drag artwork
  // into it. The burn alignment comes from the box-anchored placement (ADR-057),
  // so the on-canvas position is cosmetic in the Set-Origin workflows the jig
  // uses; centering is purely an ergonomic default the operator can drag from.
  return {
    x: Math.max(0, (bedWidth - widthMm) / 2),
    y: Math.max(0, (bedHeight - heightMm) / 2),
  };
}

export function applyAddRegistrationBox(
  s: StateSlice,
  box: ShapeObject,
): MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> } {
  let scene = s.project.scene;
  // Single jig only: drop any existing registration box first.
  for (const existing of findRegistrationBoxes(scene)) {
    scene = removeObject(scene, existing.id);
  }
  scene = addObject(scene, box);
  if (findRegistrationLayer(scene) === null) {
    scene = addLayer(scene, createRegistrationLayer());
  }
  return {
    project: { ...s.project, scene },
    selectedObjectId: box.id,
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}

// Remove the jig entirely: delete the box object(s) and the reserved registration
// layer, dropping the box from the current selection. Returns null (a no-op for the
// store) when there is no jig to remove.
export function applyRemoveRegistrationBox(
  s: StateSlice & {
    readonly selectedObjectId: string | null;
    readonly additionalSelectedIds: ReadonlySet<string>;
  },
): RemoveRegistrationBoxResult | null {
  const boxes = findRegistrationBoxes(s.project.scene);
  const layer = findRegistrationLayer(s.project.scene);
  if (boxes.length === 0 && layer === null) return null;
  const boxIds = new Set(boxes.map((box) => box.id));
  let scene = s.project.scene;
  for (const id of boxIds) scene = removeObject(scene, id);
  scene = { ...scene, layers: scene.layers.filter((l) => l.id !== REGISTRATION_LAYER_ID) };
  return {
    project: { ...s.project, scene },
    selectedObjectId:
      s.selectedObjectId !== null && boxIds.has(s.selectedObjectId) ? null : s.selectedObjectId,
    additionalSelectedIds: new Set([...s.additionalSelectedIds].filter((id) => !boxIds.has(id))),
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}
