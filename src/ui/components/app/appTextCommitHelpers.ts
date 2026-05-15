import type { Scene } from '../../../core/scene/Scene';
import type { SceneObject, TextGeometry } from '../../../core/scene/SceneObject';
import { IDENTITY_MATRIX } from '../../../core/types';
import type { SceneCommitAction } from '../../scene/SceneCommitActions';
import {
  resolveTextOperationLayer,
  type TextOperationMode,
} from '../../scene/TextOperationLayer';

export interface TextDialogCommitDraft {
  textInput: string;
  textFont: string;
  textSize: number;
  textBold: boolean;
  textItalic: boolean;
  textOperationMode: TextOperationMode;
  editingTextId: string | null;
  textPlacementPt: { x: number; y: number } | null;
}

export interface TextDialogSceneCommitResult {
  scene: Scene;
  action: Extract<SceneCommitAction, 'text-add' | 'text-edit'>;
  selectionAfter: ReadonlySet<string>;
  placedNewText: boolean;
}

export function textDialogObjectName(text: string): string {
  return text.length > 20 ? `${text.slice(0, 20)}...` : text;
}

/**
 * T2-6 Phase 3z: pure scene mutation builder for the Add/Edit Text
 * dialog. App.tsx owns the modal lifecycle and history commit, but the
 * object creation/editing and operation-layer resolution live here so
 * the root component no longer carries this scene-shaping logic inline.
 */
export function buildTextDialogSceneCommit(args: {
  scene: Scene;
  draft: TextDialogCommitDraft;
  newTextId: string;
}): TextDialogSceneCommitResult | null {
  const { scene, draft, newTextId } = args;
  if (!draft.textInput.trim()) return null;

  const resolved = resolveTextOperationLayer(scene, draft.textOperationMode);
  const name = textDialogObjectName(draft.textInput);

  if (draft.editingTextId) {
    const newScene = {
      ...resolved.scene,
      objects: resolved.scene.objects.map(o =>
        o.id === draft.editingTextId
          ? {
              ...o,
              name,
              layerId: resolved.layerId,
              geometry: {
                ...(o.geometry as TextGeometry),
                type: 'text' as const,
                text: draft.textInput,
                fontSize: draft.textSize,
                fontFamily: draft.textFont,
                bold: draft.textBold,
                italic: draft.textItalic,
              },
              _bounds: null,
              _worldTransform: null,
            }
          : o
      ),
    };

    return {
      scene: newScene,
      action: 'text-edit',
      selectionAfter: new Set([draft.editingTextId]),
      placedNewText: false,
    };
  }

  const tx = draft.textPlacementPt?.x ?? scene.canvas.width / 2 - 30;
  const ty = draft.textPlacementPt?.y ?? scene.canvas.height / 2 - 10;

  const textObj: SceneObject = {
    id: newTextId,
    type: 'text',
    name,
    layerId: resolved.layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx, ty },
    geometry: {
      type: 'text',
      text: draft.textInput,
      fontSize: draft.textSize,
      fontFamily: draft.textFont,
      bold: draft.textBold,
      italic: draft.textItalic,
    },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };

  return {
    scene: {
      ...resolved.scene,
      objects: [...resolved.scene.objects, textObj],
    },
    action: 'text-add',
    selectionAfter: new Set([textObj.id]),
    placedNewText: true,
  };
}
