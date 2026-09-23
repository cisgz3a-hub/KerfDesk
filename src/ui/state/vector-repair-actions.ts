import { isVectorPathObject, type VectorSceneObject } from '../../core/geometry';
import { joinOpenVectorPaths } from '../../core/geometry/vector-path-join';
import { unionVectorObjects } from '../../core/geometry/vector-path-union';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import { pathUsesOperation, type Project, type Scene } from '../../core/scene';
import type { PathNodeRef } from './path-node-edit-actions';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import { useToastStore } from './toast-store';

export type VectorRepairActions = {
  readonly unionSilhouetteSelection: (operationId: string) => boolean;
  readonly joinSelectedPaths: (toleranceMm: number) => boolean;
};

type RepairState = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly selectedPathNode: PathNodeRef | null;
  readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
  readonly undoStack: ReadonlyArray<Project>;
};

type RepairMutation = RepairState & {
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};
type RepairSet = (fn: (state: RepairState) => RepairState | RepairMutation) => void;

export function vectorRepairActions(set: RepairSet): VectorRepairActions {
  return {
    unionSilhouetteSelection: (operationId) => {
      let applied = false;
      set((state) => {
        const mutation = unionSelection(state, operationId);
        applied = mutation !== state;
        return mutation;
      });
      return applied;
    },
    joinSelectedPaths: (toleranceMm) => {
      let applied = false;
      set((state) => {
        const mutation = joinSelection(state, toleranceMm);
        applied = mutation !== state;
        return mutation;
      });
      return applied;
    },
  };
}

function unionSelection(state: RepairState, operationId: string): RepairState | RepairMutation {
  const scene = state.project.scene;
  const selected = selectedRepairObjects(state);
  const operation = scene.layers.find((candidate) => candidate.id === operationId);
  if (
    selected.length === 0 ||
    operation === undefined ||
    !selected.some((object) =>
      object.paths.some((path) => pathUsesOperation(object, path, operation)),
    )
  ) {
    warn('Select closed vector shapes and choose one of their operations.');
    return state;
  }
  const id = `union-${crypto.randomUUID()}`;
  const result = unionVectorObjects(
    selected,
    { id: operation.bindingOperationId ?? operation.id, color: operation.color },
    id,
  );
  if (result.kind === 'error') {
    warn(result.error.message);
    return state;
  }
  const selectedIds = new Set(selected.map((object) => object.id));
  let inserted = false;
  const objects = scene.objects.flatMap((object) => {
    if (!selectedIds.has(object.id)) return [object];
    if (inserted) return [];
    inserted = true;
    return [result.value];
  });
  const order = canonicalArtworkOrder(scene);
  const firstInOrder = order.find((objectId) => selectedIds.has(objectId));
  const next = pruneOrphanLayers(
    removeObjectIdsFromGroups(
      {
        ...scene,
        objects,
        ...(scene.artworkOrder === undefined
          ? {}
          : {
              artworkOrder: order.flatMap((objectId) =>
                objectId === firstInOrder ? [id] : selectedIds.has(objectId) ? [] : [objectId],
              ),
            }),
      },
      selectedIds,
    ),
  );
  useToastStore.getState().pushToast(`Created one silhouette using ${operation.name}.`, 'success');
  return commitRepair(state, next, [id]);
}

function joinSelection(state: RepairState, toleranceMm: number): RepairState | RepairMutation {
  const selected = selectedRepairObjects(state);
  if (selected.length === 0) {
    warn('Select unlocked vector artwork to join paths.');
    return state;
  }
  const result = joinOpenVectorPaths(selected, state.project.scene.layers, toleranceMm);
  if (result.kind === 'error') {
    warn(result.error.message);
    return state;
  }
  const plan = result.value;
  if (plan.joins + plan.closures === 0) {
    warn(
      'No endpoints can join within this tolerance. Paths need the same operations, colour and artwork settings, with no ambiguous junctions or manual tabs.',
    );
    return state;
  }
  const selectedIds = new Set(selected.map((object) => object.id));
  const replacements = new Map(plan.objects.map((object) => [object.id, object]));
  const removed = new Set([...selectedIds].filter((id) => !replacements.has(id)));
  const scene = state.project.scene;
  const next = removeObjectIdsFromGroups(
    {
      ...scene,
      objects: scene.objects.flatMap((object) => {
        if (!selectedIds.has(object.id)) return [object];
        const replacement = replacements.get(object.id);
        return replacement === undefined ? [] : [replacement];
      }),
      ...(scene.artworkOrder === undefined
        ? {}
        : { artworkOrder: scene.artworkOrder.filter((id) => !removed.has(id)) }),
    },
    removed,
  );
  useToastStore
    .getState()
    .pushToast(
      `Joined ${plan.joins} gap(s), closed ${plan.closures} path(s). ${plan.remainingOpenPaths} open path(s) remain.`,
      'success',
    );
  return commitRepair(
    state,
    next,
    plan.objects.map((object) => object.id),
  );
}

function selectedRepairObjects(state: RepairState): ReadonlyArray<VectorSceneObject> {
  const ids = new Set(selectedObjectIds(state));
  const objects = state.project.scene.objects.filter(
    (object): object is VectorSceneObject =>
      ids.has(object.id) && object.locked !== true && isVectorPathObject(object),
  );
  return objects.length === ids.size ? objects : [];
}

function commitRepair(
  state: RepairState,
  scene: Scene,
  ids: ReadonlyArray<string>,
): RepairMutation {
  return {
    project: { ...state.project, scene },
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function warn(message: string): void {
  useToastStore.getState().pushToast(message, 'warning');
}
