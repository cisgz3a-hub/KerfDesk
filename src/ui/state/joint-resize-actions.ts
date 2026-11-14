import { err, ok, type Result } from '../../core/result';
import type { Project } from '../../core/scene';
import { previewJointResize, type JointResizeRequest } from '../../core/geometry/joint-resize';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './undo-stack';
import type { AppState } from './store';
import { movedTabsNotice } from './path-node-edit-actions';
import { useToastStore } from './toast-store';

export type JointResizeSession = {
  readonly project: Project;
  readonly documentEpoch: number;
  readonly ids: ReadonlyArray<string>;
};
export function jointResizeSessionIsCurrent(state: AppState, session: JointResizeSession): boolean {
  const selected = selectedObjectIds(state);
  return (
    state.project === session.project &&
    state.projectDocumentEpoch === session.documentEpoch &&
    selected.length === session.ids.length &&
    session.ids.every((id) => selected.includes(id))
  );
}

/** Recalculate from the unchanged owner; a captured preview is never trusted as output. */
export function jointResizeSelectionMutation(
  state: AppState,
  session: JointResizeSession,
  request: JointResizeRequest,
  candidateIds: ReadonlyArray<string>,
): Result<Partial<AppState>, { readonly message: string }> {
  if (!jointResizeSessionIsCurrent(state, session))
    return err({
      message: 'Artwork or selection changed. Reopen Resize Joint Openings to review it again.',
    });
  const sources = session.project.scene.objects.filter((object) => session.ids.includes(object.id));
  const result = previewJointResize(sources, request, candidateIds);
  if (result.kind === 'error') return result;
  const changed = new Map(result.value.objects.map((object) => [object.id, object]));
  const { changedFeatures, movedTabs } = result.value;
  const tabs = movedTabsNotice(movedTabs);
  const features = changedFeatures === 1 ? '1 joint feature' : `${changedFeatures} joint features`;
  useToastStore
    .getState()
    .pushToast(`Resized ${features}.${tabs === '' ? '' : ` ${tabs}`}`, 'info');
  return ok({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) => changed.get(object.id) ?? object),
      },
    },
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack, 'Resize joint openings'),
    redoStack: [],
    dirty: true,
  });
}
