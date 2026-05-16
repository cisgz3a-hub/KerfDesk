import type { Scene } from '../../../core/scene/Scene';
import type { SceneObject } from '../../../core/scene/SceneObject';
import {
  textOperationModeForObject,
  type TextOperationMode,
} from '../../scene/TextOperationLayer';

export interface TextPlacementDialogRequest {
  editingTextId: null;
  textOperationMode: TextOperationMode;
  textPlacementPt: { x: number; y: number };
  showDialog: true;
}

export interface TextEditDialogRequest {
  textOperationMode: TextOperationMode;
  textPlacementPt: null;
  selectionAfter: ReadonlySet<string>;
}

/**
 * T2-6 Phase 3ar: pure Add/Edit Text dialog launch decisions.
 * App.tsx still owns dialog-store side effects, while this helper owns
 * the operation-mode and placement/selection policy for opening the dialog.
 */
export function buildTextPlacementDialogRequest(world: { x: number; y: number }): TextPlacementDialogRequest {
  return {
    editingTextId: null,
    textOperationMode: 'engrave',
    textPlacementPt: { x: world.x, y: world.y },
    showDialog: true,
  };
}

export function buildTextEditDialogRequest(scene: Scene, obj: SceneObject): TextEditDialogRequest {
  return {
    textOperationMode: textOperationModeForObject(scene, obj),
    textPlacementPt: null,
    selectionAfter: new Set([obj.id]),
  };
}
