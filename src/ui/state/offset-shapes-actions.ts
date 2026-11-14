// Offset Shapes (LightBurn gap batch 3, ADR-410). The dialog's action: offset
// the selection outward, inward or both ways, add the results as new objects
// with their own operation (as the ADR-103 offset does), and optionally delete
// the originals. The whole edit is one undo step.

import { isVectorPathObject, type VectorSceneObject } from '../../core/geometry';
import { offsetShapes, type OffsetShapesOptions } from '../../core/geometry/offset-shapes';
import { ok } from '../../core/result';
import {
  addObject,
  type ImportedSvg,
  type Layer,
  type Project,
  type Scene,
} from '../../core/scene';
import { geometryToolSkippedNotice, geometryToolSources } from './geometry-tool-sources';
import { repairDanglingObjectDependencies, reportDependencyRepairs } from './object-delete-actions';
import { removedTabsNotice } from './removed-tabs-notice';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import { pruneOrphanLayers, pushUndo, type StateSlice } from './scene-mutations';
import { useToastStore } from './toast-store';
import { reusableOffsetShapes, type PreparedOffsetShapes } from './vector-op-prepared';
import { prepareIndependentArtworkOn } from './independent-artwork';
import { offsetOperationOffNotice, offsetResultOperation } from './offset-result-operation';
import { offsetNoInwardNotice } from './offset-shapes-notices';
import {
  inheritRegistrationArtworkOutput,
  registrationArtworkSnapshot,
} from './registration-output-actions';
import { uniqueObjectId } from './vector-path-actions';

export type OffsetShapesRequest = OffsetShapesOptions & {
  /** Remove the selected shapes once the offset objects exist. */
  readonly deleteOriginals: boolean;
  /**
   * The source operation the result's own operation is cloned from (ADR-410
   * Amendment 6). Unset, or not one of the sources' operations, picks the
   * default that offsetResultOperation describes.
   */
  readonly operationId?: string;
};

export type OffsetShapesActions = {
  /**
   * Returns true when the offset was added; false leaves the project as it was.
   * A dialog's settled background result is committed when its inputs still
   * match (ADR-609); otherwise the offset is computed here.
   */
  readonly offsetShapesSelection: (
    request: OffsetShapesRequest,
    prepared?: PreparedOffsetShapes,
  ) => boolean;
};

type OffsetShapesState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly registrationArtworkOutputSnapshot?: Readonly<Record<string, boolean>> | null;
};

type OffsetShapesMutation = {
  readonly project: Project;
  readonly selectedObjectId: string;
  readonly selectedPathNode: null;
  readonly selectedPathNodes: [];
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
  readonly registrationArtworkOutputSnapshot?: Readonly<Record<string, boolean>>;
};

type OffsetShapesSet = (
  fn: (state: OffsetShapesState) => OffsetShapesMutation | OffsetShapesState,
) => unknown;

export function offsetShapesActions(
  copySet: OffsetShapesSet,
  get: () => OffsetShapesState,
): OffsetShapesActions {
  return {
    offsetShapesSelection: (request, prepared) => {
      const state = get();
      // The guard evaluates a proposed edit before admitting it. Keep messages
      // about that edit out of the preview phase, just like the scene itself.
      const notifications: Array<() => void> = [];
      const next = offsetShapesMutation(
        state,
        request,
        (notify) => notifications.push(notify),
        prepared,
      );
      if (next === state) {
        notifications.forEach((notify) => notify());
        return false;
      }
      // Copies and replacements share the Pro admission: without Pro, replacing
      // existing Pro artwork changes that artwork and asks first (ADR-592).
      const committed = copySet(() => next);
      if (committed === false) return false;
      notifications.forEach((notify) => notify());
      return true;
    },
  };
}

/** The ids Offset Shapes gives its new objects in this scene. */
export function offsetShapesResultIds(scene: Scene): {
  readonly outward: string;
  readonly inward: string;
} {
  return {
    outward: uniqueObjectId(scene, 'offset'),
    inward: uniqueObjectId(scene, 'offset-inward'),
  };
}

/**
 * The unlocked vector shapes Offset Shapes works on, in scene order, and the
 * notice for what it left out (ADR-350 Amendment 2): variable data always, and
 * the registration jig too when the originals are deleted.
 */
export function offsetShapesTargets(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
  deleteOriginals: boolean,
): { readonly targets: ReadonlyArray<VectorSceneObject>; readonly notice: string } {
  const selected = new Set(selectedIds);
  const candidates = scene.objects.filter(
    (object): object is VectorSceneObject =>
      selected.has(object.id) && object.locked !== true && isVectorPathObject(object),
  );
  const { kept, skipped } = geometryToolSources(
    scene,
    candidates,
    deleteOriginals ? 'replace' : 'variable',
  );
  return { targets: kept, notice: geometryToolSkippedNotice(skipped) };
}

function offsetShapesMutation(
  state: OffsetShapesState,
  request: OffsetShapesRequest,
  afterCommit: (notify: () => void) => void,
  prepared?: PreparedOffsetShapes,
): OffsetShapesMutation | OffsetShapesState {
  const { targets, notice } = offsetShapesTargets(
    state.project.scene,
    selectedObjectIds(state),
    request.deleteOriginals,
  );
  if (notice !== '') {
    const tone = targets.length === 0 ? 'warning' : 'info';
    afterCommit(() => useToastStore.getState().pushToast(notice, tone));
    if (targets.length === 0) return state;
  }
  const scene0 = state.project.scene;
  const reused = reusableOffsetShapes(prepared, scene0, targets, request);
  const result =
    reused === undefined
      ? offsetShapes(targets, request, offsetShapesResultIds(scene0))
      : ok(reused.result);
  if (result.kind === 'error') {
    afterCommit(() => useToastStore.getState().pushToast(result.error.message, 'warning'));
    return state;
  }
  const created = [result.value.outward, result.value.inward].filter(
    (object): object is ImportedSvg => object !== null,
  );
  const first = created[0];
  if (first === undefined) return state;
  const operation = resultOperation(state, request, targets, result.value.inward, afterCommit);
  let scene = scene0;
  const createdIds: string[] = [];
  for (const artwork of created) {
    const prepared = prepareIndependentArtworkOn(scene, named(artwork, targets), operation);
    scene = addObject(prepared.scene, prepared.object);
    createdIds.push(prepared.object.id);
  }
  if (request.deleteOriginals) scene = removeOriginals(scene, targets, afterCommit);
  return {
    ...withArtworkOutputs(state, { ...state.project, scene }, createdIds, operation),
    selectedObjectId: createdIds[0] ?? first.id,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(createdIds.slice(1)),
    undoStack: pushUndo(state.project, state.undoStack, 'Offset Shapes'),
    redoStack: [],
    dirty: true,
  };
}

// The notices about what the offset makes, and the operation it goes on
// (ADR-410 Amendment 6).
function resultOperation(
  state: OffsetShapesState,
  request: OffsetShapesRequest,
  targets: ReadonlyArray<VectorSceneObject>,
  inward: ImportedSvg | null,
  afterCommit: (notify: () => void) => void,
): Layer | null {
  const warn = (message: string, tone: 'info' | 'warning' = 'warning') => {
    if (message !== '') afterCommit(() => useToastStore.getState().pushToast(message, tone));
  };
  if (request.direction === 'both' && inward === null)
    warn('Only the outward offset was added: the inward one collapsed the shape.', 'info');
  // A partial collapse, or an open line under Inward, is named (T33-P2-2).
  else warn(offsetNoInwardNotice(targets, inward, request));
  const snapshot = registrationArtworkSnapshot(state);
  const operation = offsetResultOperation(state.project.scene, targets, {
    primaryId: state.selectedObjectId,
    ...(request.operationId === undefined ? {} : { chosenId: request.operationId }),
    snapshot,
  });
  warn(offsetOperationOffNotice(operation, snapshot));
  return operation;
}

// A jig's Artwork only turns the offset on with the art it was cloned from.
function withArtworkOutputs(
  state: OffsetShapesState,
  project: Project,
  createdIds: ReadonlyArray<string>,
  operation: Layer | null,
): {
  readonly project: Project;
  readonly registrationArtworkOutputSnapshot?: Readonly<Record<string, boolean>>;
} {
  if (operation === null) return { project };
  const clones = createdIds.flatMap((id) => {
    const object = project.scene.objects.find((candidate) => candidate.id === id);
    const cloneId = object?.operationIds?.[0];
    return cloneId === undefined ? [] : [{ sourceId: operation.id, cloneId }];
  });
  return inheritRegistrationArtworkOutput(state, project, clones) ?? { project };
}

// A single named source names its offset (tools audit T1, T33-P3-2).
function named(artwork: ImportedSvg, targets: ReadonlyArray<VectorSceneObject>): ImportedSvg {
  const name = targets.length === 1 ? targets[0]?.name?.trim() : undefined;
  if (name === undefined || name === '') return artwork;
  const inward = artwork.source.startsWith('Offset inward');
  return { ...artwork, name: `${name} ${inward ? 'inward offset' : 'offset'}` };
}

function removeOriginals(
  scene: Scene,
  targets: ReadonlyArray<VectorSceneObject>,
  afterCommit: (notify: () => void) => void,
): Scene {
  const ids = new Set(targets.map((object) => object.id));
  const kept: Scene = {
    ...scene,
    objects: scene.objects.filter((object) => !ids.has(object.id)),
    ...(scene.artworkOrder === undefined
      ? {}
      : { artworkOrder: scene.artworkOrder.filter((id) => !ids.has(id)) }),
  };
  const repaired = repairDanglingObjectDependencies(removeObjectIdsFromGroups(kept, ids));
  afterCommit(() => reportDependencyRepairs(repaired));
  // The offset outlines are new objects without the originals' tabs placed by
  // hand (ADR-494 Amendment 3).
  const tabs = removedTabsNotice(targets, 'deleted originals');
  if (tabs !== '') afterCommit(() => useToastStore.getState().pushToast(tabs, 'info'));
  return pruneOrphanLayers(repaired.scene);
}
