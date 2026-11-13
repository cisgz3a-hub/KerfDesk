// Convert to Path on the selection (LightBurn Path > Convert to Path), split
// out of vector-path-actions.ts for its size cap. Variable text and the
// registration jig outlines are left as they are and the user is told why
// (tools audit T1, T26-P1-1 and T26-P2-2).

import { isVectorPathObject } from '../../core/geometry';
import { isRegistrationBox, replaceObject } from '../../core/scene';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import { objectVariableTemplate } from '../../core/variables/object-variable-template';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './scene-mutations';
import { useToastStore } from './toast-store';
import type { VectorPathMutation, VectorPathState } from './vector-path-actions';
import { convertVectorObjectToPath } from './vector-path-conversion';

export function convertSelectionToPathMutation(
  state: VectorPathState,
): VectorPathMutation | VectorPathState {
  const selectedIds = new Set(selectedObjectIds(state));
  if (selectedIds.size === 0) return state;
  let scene = state.project.scene;
  let changed = false;
  const skipped = { variableText: 0, jigOutline: 0 };
  for (const object of state.project.scene.objects) {
    if (!selectedIds.has(object.id) || object.locked === true || !isVectorPathObject(object)) {
      continue;
    }
    if (isBooleanCompoundObject(object)) continue;
    // Variable text holds template glyphs ("{{serial:4}}") that output replaces
    // with the record value; converting them would burn the braces (T26-P1-1).
    if (object.kind === 'text' && objectVariableTemplate(object) !== undefined) {
      skipped.variableText += 1;
      continue;
    }
    // The registration jig is its outlines: converting them dissolves the jig
    // and its per-piece burn order (T26-P2-2), as Optimize Shapes already skips.
    if (isRegistrationBox(object)) {
      skipped.jigOutline += 1;
      continue;
    }
    const materialized = convertVectorObjectToPath(object);
    scene = replaceObject(scene, object.id, materialized);
    changed = true;
  }
  const notice = convertSkippedNotice(skipped);
  if (notice !== '') useToastStore.getState().pushToast(notice, 'info');
  if (!changed) return state;
  return {
    project: { ...state.project, scene },
    selectedObjectId: state.selectedObjectId,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(state.additionalSelectedIds),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function convertSkippedNotice(skipped: {
  readonly variableText: number;
  readonly jigOutline: number;
}): string {
  const parts: string[] = [];
  if (skipped.variableText > 0)
    parts.push(
      `${skipped.variableText === 1 ? 'Variable text was' : `${skipped.variableText} variable texts were`} left as text: use Bake Variable Text first to fix its value.`,
    );
  if (skipped.jigOutline > 0) parts.push('The registration jig outlines were left as they are.');
  return parts.join(' ');
}
