import {
  addLayer,
  addObject,
  createArtworkOperation,
  operationIdsForObject,
  remapSceneObjectOperationBindings,
  sceneObjectUsesOperation,
  type Layer,
  type Scene,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { removeSceneObjectsFromState } from './object-delete-actions';
import {
  remapSceneObjectCopyDependencies,
  sceneObjectCopyDependencyId,
  sceneObjectCopyClosure,
} from './scene-object-copy-dependencies';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

const PASTE_OFFSET_MM = 10;

export type SceneClipboard = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
  readonly selectedObjectIds: ReadonlyArray<string>;
  readonly sourceDocumentEpoch: number;
  readonly groups?: ReadonlyArray<SceneGroup>;
};

export type SceneClipboardActions = {
  readonly copySelection: () => void;
  readonly cutSelection: () => void;
  readonly pasteClipboard: () => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function sceneClipboardActions(set: Setter): SceneClipboardActions {
  return {
    copySelection: () =>
      set((state) => {
        const clipboard = clipboardFromSelection(state);
        return clipboard === null ? state : { sceneClipboard: clipboard };
      }),
    cutSelection: () =>
      set((state) => {
        const clipboard = clipboardFromSelection(state);
        if (clipboard === null) return state;
        const removed = removeSceneObjectsFromState(state, clipboard.selectedObjectIds);
        return removed === state ? state : { ...removed, sceneClipboard: clipboard };
      }),
    pasteClipboard: () =>
      set((state) => {
        const clipboard = state.sceneClipboard;
        if (clipboard === null || clipboard.objects.length === 0) return state;
        const prepared = prepareClipboardPaste(
          state.project.scene,
          clipboard.layers,
          clipboard.objects,
          clipboard.selectedObjectIds,
          clipboard.groups ?? [],
          clipboard.sourceDocumentEpoch === state.projectDocumentEpoch,
        );
        const pasted = prepared.objects;
        let scene = prepared.scene;
        for (const object of pasted) scene = addObject(scene, object);
        if (prepared.groups.length > 0) {
          scene = { ...scene, groups: [...(scene.groups ?? []), ...prepared.groups] };
        }
        const [primary, ...rest] = prepared.selectedObjectIds;
        return {
          project: { ...state.project, scene },
          selectedObjectId: primary ?? null,
          additionalSelectedIds: new Set(rest),
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

function clipboardFromSelection(
  state: Pick<
    AppState,
    'project' | 'projectDocumentEpoch' | 'selectedObjectId' | 'additionalSelectedIds'
  >,
): SceneClipboard | null {
  const ids = [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
  if (ids.length === 0) return null;
  const objects = sceneObjectCopyClosure(state.project.scene.objects, new Set(ids)).map(
    cloneSceneObject,
  );
  if (objects.length === 0) return null;
  const copiedIds = new Set(objects.map((object) => object.id));
  const groups = (state.project.scene.groups ?? [])
    .filter(
      (group) => group.objectIds.length >= 2 && group.objectIds.every((id) => copiedIds.has(id)),
    )
    .map((group) => structuredClone(group) as SceneGroup);
  return {
    objects,
    layers: copiedLayersForObjects(state.project.scene, objects),
    selectedObjectIds: ids.filter((id) => copiedIds.has(id)),
    sourceDocumentEpoch: state.projectDocumentEpoch,
    groups,
  };
}

function copiedLayersForObjects(
  scene: Scene,
  objects: ReadonlyArray<SceneObject>,
): ReadonlyArray<Layer> {
  const operationIds = new Set(
    objects.flatMap((object) => operationIdsForObject(object, scene.layers)),
  );
  return scene.layers.filter((layer) => operationIds.has(layer.id)).map(cloneLayer);
}

function cloneClipboardObjects(
  scene: Scene,
  objects: ReadonlyArray<SceneObject>,
  sourceOperations: ReadonlyArray<Layer>,
  operationIdMap: ReadonlyMap<string, string>,
): {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly idMap: ReadonlyMap<string, string>;
} {
  const idMap = new Map(objects.map((object) => [object.id, crypto.randomUUID()] as const));
  const targetIds = new Set(scene.objects.map((object) => object.id));
  for (const object of objects) {
    const dependencyId = sceneObjectCopyDependencyId(object);
    if (dependencyId !== undefined && !idMap.has(dependencyId) && targetIds.has(dependencyId)) {
      idMap.set(dependencyId, crypto.randomUUID());
    }
  }
  return {
    idMap,
    objects: objects.map((object) => {
      const clone = {
        ...cloneSceneObject(object),
        id: idMap.get(object.id) ?? crypto.randomUUID(),
        transform: {
          ...object.transform,
          x: object.transform.x + PASTE_OFFSET_MM,
          y: object.transform.y + PASTE_OFFSET_MM,
        },
      } as SceneObject;
      return remapSceneObjectOperationBindings(
        remapSceneObjectCopyDependencies(clone, idMap),
        sourceOperations,
        operationIdMap,
      );
    }),
  };
}

function prepareClipboardPaste(
  scene: Scene,
  copiedLayers: ReadonlyArray<Layer>,
  objects: ReadonlyArray<SceneObject>,
  selectedObjectIds: ReadonlyArray<string>,
  groups: ReadonlyArray<SceneGroup> = [],
  reuseExistingOperations = false,
): {
  readonly scene: Scene;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly selectedObjectIds: ReadonlyArray<string>;
  readonly groups: ReadonlyArray<SceneGroup>;
} {
  let out = scene;
  const operationIdMap = new Map<string, string>();
  for (const source of copiedLayers) {
    const existing = scene.layers.find((operation) => operation.id === source.id);
    if (existing !== undefined && reuseExistingOperations) {
      // Same-project Paste remains in the source process operation. This is
      // the ordinary editor meaning of copying artwork; cloning the operation
      // here stacked a second emission over the same visible object.
      operationIdMap.set(source.id, existing.id);
      if (source.bindingOperationId !== undefined) {
        operationIdMap.set(source.bindingOperationId, existing.id);
      }
      continue;
    }
    const representative = objects.find((object) => sceneObjectUsesOperation(object, source));
    if (representative === undefined) continue;
    const seed = createArtworkOperation(out, representative, {
      mode: source.mode,
      name: source.name,
      subLayers: source.subLayers,
    }).operation;
    const operation: Layer = {
      ...cloneLayer(source),
      id: seed.id,
      name: seed.name,
      color: seed.color,
      subLayers: seed.subLayers,
    };
    operationIdMap.set(source.id, operation.id);
    if (source.bindingOperationId !== undefined) {
      operationIdMap.set(source.bindingOperationId, operation.id);
    }
    out = addLayer(out, operation);
  }
  const reservedOperationIds = operationIdentityIds(out.layers);
  protectCollidingMissingOperationIds(out, objects, operationIdMap, reservedOperationIds);
  const cloned = cloneClipboardObjects(scene, objects, copiedLayers, operationIdMap);
  const materialized = materializeClipboardObjects(
    out,
    cloned.objects,
    objects,
    copiedLayers,
    operationIdMap,
    reservedOperationIds,
  );
  out = materialized.scene;
  return {
    scene: out,
    objects: materialized.objects,
    selectedObjectIds: selectedObjectIds.flatMap((id) => {
      const mapped = cloned.idMap.get(id);
      return mapped === undefined ? [] : [mapped];
    }),
    groups: groups.map((group) => ({
      ...structuredClone(group),
      id: crypto.randomUUID(),
      objectIds: group.objectIds.flatMap((id) => {
        const mapped = cloned.idMap.get(id);
        return mapped === undefined ? [] : [mapped];
      }),
    })),
  };
}

function materializeClipboardObjects(
  scene: Scene,
  objects: ReadonlyArray<SceneObject>,
  sourceObjects: ReadonlyArray<SceneObject>,
  copiedLayers: ReadonlyArray<Layer>,
  operationIdMap: ReadonlyMap<string, string>,
  reservedOperationIds: Set<string>,
): { readonly scene: Scene; readonly objects: ReadonlyArray<SceneObject> } {
  let out = scene;
  const materialized: SceneObject[] = [];
  for (const [index, clone] of objects.entries()) {
    const object = protectUnownedLegacyPathBindings(clone, reservedOperationIds);
    const sourceObject = sourceObjects[index];
    const ownedTargetOperationIds = new Set(
      sourceObject === undefined
        ? []
        : operationIdsForObject(sourceObject, copiedLayers).flatMap((sourceId) => {
            const targetId = operationIdMap.get(sourceId);
            return targetId === undefined ? [] : [targetId];
          }),
    );
    const sourceOwnedOperationIds = operationIdsForObject(object, out.layers).filter((id) =>
      ownedTargetOperationIds.has(id),
    );
    if (sourceOwnedOperationIds.length > 0) {
      materialized.push(remapClipboardTabAnchors(object, copiedLayers, operationIdMap, out.layers));
      continue;
    }
    // Malformed/legacy clipboard artwork with no resolvable binding must not
    // paste as invisible-to-output geometry. Give it one explicit operation.
    const created = createArtworkOperation(
      out,
      object,
      object.kind === 'raster-image' ? { mode: 'image' } : {},
    );
    out = addLayer(out, created.operation);
    materialized.push(created.object);
  }
  return { scene: out, objects: materialized };
}

function protectCollidingMissingOperationIds(
  targetScene: Scene,
  objects: ReadonlyArray<SceneObject>,
  operationIdMap: Map<string, string>,
  reservedIds: Set<string>,
): void {
  const targetBindingIds = new Set(
    targetScene.layers.map((operation) => operation.bindingOperationId ?? operation.id),
  );
  for (const operationId of operationIdMap.values()) reservedIds.add(operationId);
  for (const object of objects) {
    for (const sourceId of explicitOperationIdsForObject(object)) {
      if (operationIdMap.has(sourceId) || !targetBindingIds.has(sourceId)) continue;
      const unresolvedId = freshUnresolvedOperationId(reservedIds);
      operationIdMap.set(sourceId, unresolvedId);
    }
  }
}

function explicitOperationIdsForObject(object: SceneObject): ReadonlySet<string> {
  const operationIds = new Set(object.operationIds ?? []);
  if ('paths' in object) {
    for (const path of object.paths) {
      for (const operationId of path.operationIds ?? []) operationIds.add(operationId);
    }
  }
  return operationIds;
}

function protectUnownedLegacyPathBindings(
  object: SceneObject,
  reservedIds: Set<string>,
): SceneObject {
  if (!('paths' in object) || object.operationIds !== undefined) return object;
  let unresolvedId: string | undefined;
  const paths = object.paths.map((path) => {
    if (path.operationIds !== undefined) return path;
    unresolvedId ??= freshUnresolvedOperationId(reservedIds);
    return { ...path, operationIds: [unresolvedId] };
  });
  return { ...object, paths } as SceneObject;
}

function operationIdentityIds(operations: ReadonlyArray<Layer>): Set<string> {
  const ids = new Set<string>();
  for (const operation of operations) {
    ids.add(operation.id);
    if (operation.bindingOperationId !== undefined) ids.add(operation.bindingOperationId);
  }
  return ids;
}

function freshUnresolvedOperationId(reservedIds: Set<string>): string {
  let id = crypto.randomUUID();
  while (reservedIds.has(id)) id = crypto.randomUUID();
  reservedIds.add(id);
  return id;
}

function remapClipboardTabAnchors(
  object: SceneObject,
  sourceOperations: ReadonlyArray<Layer>,
  operationIdMap: ReadonlyMap<string, string>,
  targetOperations: ReadonlyArray<Layer>,
): SceneObject {
  if (object.cncTabAnchors === undefined || object.cncTabAnchors.length === 0) return object;
  const colorMap = new Map<string, string>();
  for (const source of sourceOperations) {
    const targetId = operationIdMap.get(source.id);
    const target = targetOperations.find((operation) => operation.id === targetId);
    if (target !== undefined) colorMap.set(source.color.toLowerCase(), target.color);
  }
  return {
    ...object,
    cncTabAnchors: object.cncTabAnchors.map((anchor) => ({
      ...anchor,
      layerColor: colorMap.get(anchor.layerColor.toLowerCase()) ?? anchor.layerColor,
    })),
  } as SceneObject;
}

function cloneSceneObject(object: SceneObject): SceneObject {
  return structuredClone(object) as SceneObject;
}

function cloneLayer(layer: Layer): Layer {
  return structuredClone(layer) as Layer;
}
