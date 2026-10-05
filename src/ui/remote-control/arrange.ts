import {
  buildSelectionAlignEdit,
  buildSelectionDistributeEdit,
  buildSelectionFlipEdit,
  type SceneObject,
  type SelectionAlignKind,
  type SelectionDistributeKind,
  type SelectionFlipAxis,
} from '../../core/scene';
import type { AppState } from '../state/store';
import type { SelectionTransformEdit } from '../state/selection-transform-actions';
import { sceneObjectCopyClosure } from '../state/scene-object-copy-dependencies';
import { sceneLimitOverrun } from '../state/scene-copy-room';
import { newlyIntroducedProFeature } from '../licensing/pro-operation-policy';
import { proFeaturesUnlocked } from '../licensing/edition';
import { withUndoStepName } from '../state/undo-step-names';
import { historyProjection } from './authoring-projections';
import { editableArtwork, expandedArtworkGroupIds, validateTransforms } from './transforms';
import { publicIdentifier, selectedIds } from './projections';
import { RemoteFault } from './fault';
import type { RemoteArrangeAction, RemoteAppStore } from './types';

const ALIGN: Partial<Record<RemoteArrangeAction, SelectionAlignKind>> = {
  align_left: 'left',
  align_center: 'center-x',
  align_right: 'right',
  align_top: 'top',
  align_middle: 'center-y',
  align_bottom: 'bottom',
};
type PreparedArrange = () => Record<string, unknown>;
const DISTRIBUTE: Partial<Record<RemoteArrangeAction, SelectionDistributeKind>> = {
  distribute_horizontal: 'horizontal-centers',
  distribute_vertical: 'vertical-centers',
};
const FLIP: Partial<Record<RemoteArrangeAction, SelectionFlipAxis>> = {
  mirror_horizontal: 'horizontal',
  mirror_vertical: 'vertical',
};

/** Build and check the whole edit before selection, history or project is published. */
export function prepareArrange(
  state: AppState,
  store: RemoteAppStore,
  requested: readonly string[],
  action: RemoteArrangeAction,
): PreparedArrange {
  const ids = expandedArtworkGroupIds(state, requested);
  const objects = editableArtwork(state, ids);
  const referenceId = requested.at(-1);
  if (referenceId === undefined) throw new RemoteFault('invalid_arguments');
  const transforms = arrangeTransforms(state, objects, referenceId, action);
  if (transforms !== null) {
    validateTransforms(objects, transforms);
    return () => {
      withUndoStepName('Arrange artwork', () => state.applySelectionTransforms(transforms));
      return authoringReceipt(
        store.getState(),
        transforms.map((entry) => entry.id),
      );
    };
  }
  if (action === 'group' && ids.length < 2) throw new RemoteFault('unsupported_operation');
  if (action === 'duplicate') validateDuplicate(state, ids);
  const affected = action === 'delete' ? deleteAffectedIds(state, ids) : ids;
  // Removing a guide/mask can change dependent artwork. Locked or hidden dependants
  // are checked as well, rather than silently changing them through deletion.
  editableArtwork(state, affected);
  return () => {
    if (action === 'delete') {
      withUndoStepName('Delete artwork', () => state.removeSceneObjects(ids));
      return authoringReceipt(store.getState(), affected);
    }
    state.selectObjects(ids);
    const selectedState = store.getState();
    assertSelectionOwner(state, selectedState, ids);
    withUndoStepName(action === 'duplicate' ? 'Duplicate artwork' : 'Arrange artwork', () => {
      if (action === 'group') selectedState.groupSelection();
      if (action === 'ungroup') selectedState.ungroupSelection();
      if (action === 'duplicate') selectedState.duplicateSelection();
    });
    const next = store.getState();
    const changedIds =
      action === 'duplicate'
        ? next.project.scene.objects
            .filter((object) => !state.project.scene.objects.some((old) => old.id === object.id))
            .map((object) => object.id)
        : next.project === state.project
          ? []
          : ids;
    return authoringReceipt(next, changedIds);
  };
}

/** Selection listeners may open another document; never apply the following edit there. */
function assertSelectionOwner(before: AppState, current: AppState, ids: readonly string[]): void {
  if (
    current.project !== before.project ||
    current.projectDocumentEpoch !== before.projectDocumentEpoch ||
    current.projectOpenRequestEpoch !== before.projectOpenRequestEpoch
  )
    throw new RemoteFault('stale_revision');
  if (current.pendingUndo !== null) throw new RemoteFault('busy');
  const selected = new Set(selectedIds(current));
  if (selected.size !== ids.length || !ids.every((id) => selected.has(id)))
    throw new RemoteFault('stale_revision');
}

function arrangeTransforms(
  state: AppState,
  objects: readonly SceneObject[],
  referenceId: string,
  action: RemoteArrangeAction,
): readonly SelectionTransformEdit[] | null {
  const align = ALIGN[action];
  const distribute = DISTRIBUTE[action];
  const flip = FLIP[action];
  const result =
    align !== undefined
      ? buildSelectionAlignEdit(
          objects,
          { kind: align, referenceId },
          state.project.scene.groups ?? [],
        )
      : distribute !== undefined
        ? buildSelectionDistributeEdit(
            objects,
            { kind: distribute },
            state.project.scene.groups ?? [],
          )
        : flip !== undefined
          ? buildSelectionFlipEdit(objects, flip)
          : null;
  if (result?.kind === 'error') throw new RemoteFault('unsupported_operation');
  return result === null ? null : result.transforms;
}

function validateDuplicate(state: AppState, ids: readonly string[]): void {
  const closure = sceneObjectCopyClosure(state.project.scene.objects, new Set(ids));
  if (closure.length > 200) throw new RemoteFault('unsupported_operation');
  editableArtwork(
    state,
    closure.map((object) => object.id),
  );
  const scene = copyAdmissionScene(state, closure);
  if (sceneLimitOverrun(state.project.scene, scene) !== null)
    throw new RemoteFault('unsupported_operation');
  if (
    !proFeaturesUnlocked() &&
    newlyIntroducedProFeature(state.project, { ...state.project, scene }) !== null
  )
    throw new RemoteFault('needs_pro');
  // Never call the ordinary deferred admission path when it would hold a copy.
  // The remote client must retry with a fresh revision and request after local unlock.
}

/** Admission uses identities/counts and bindings, never clones large raster bytes twice. */
function copyAdmissionScene(state: AppState, closure: readonly SceneObject[]) {
  const ids = new Map(closure.map((object) => [object.id, crypto.randomUUID()]));
  const groups = (state.project.scene.groups ?? [])
    .filter((group) => group.objectIds.every((id) => ids.has(id)))
    .map((group) => ({
      ...group,
      id: crypto.randomUUID(),
      objectIds: group.objectIds.map((id) => ids.get(id) ?? id),
    }));
  return {
    ...state.project.scene,
    objects: [
      ...state.project.scene.objects,
      ...closure.map((object) => ({ ...object, id: ids.get(object.id) ?? object.id })),
    ],
    groups: [...(state.project.scene.groups ?? []), ...groups],
  };
}

function deleteAffectedIds(state: AppState, ids: readonly string[]): string[] {
  const deleted = new Set(ids);
  const affected = state.project.scene.objects
    .filter(
      (object) =>
        (object.kind === 'text' &&
          object.pathText !== undefined &&
          deleted.has(object.pathText.guideObjectId)) ||
        (object.kind === 'raster-image' &&
          object.imageMaskId !== undefined &&
          deleted.has(object.imageMaskId)),
    )
    .map((object) => object.id);
  const all = [...new Set([...ids, ...affected])];
  if (all.length > 200) throw new RemoteFault('unsupported_operation');
  return all;
}

export function authoringReceipt(state: AppState, changedArtworkIds: readonly string[]) {
  return {
    changedArtworkIds: changedArtworkIds.filter(publicIdentifier).slice(0, 200),
    selection: selectedIds(state).filter(publicIdentifier).slice(0, 200),
    history: historyProjection(state),
  };
}

export function applyHistory(state: AppState, store: RemoteAppStore, action: 'undo' | 'redo') {
  state[action]();
  const next = store.getState();
  const before = new Map(state.project.scene.objects.map((object) => [object.id, object]));
  const after = new Map(next.project.scene.objects.map((object) => [object.id, object]));
  const changedIds = [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => before.get(id) !== after.get(id),
  );
  return authoringReceipt(next, changedIds);
}
