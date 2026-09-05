// design-apply-mutation — commit a Design Studio sketch into the scene
// (ADR-272, Phase N DS-5; layered by Amendment 1, DS-8).
//
// The ONE place the Studio writes to the project. Every designed entity
// becomes a scene object; entities GROUP BY CARVE LAYER, each design layer
// becomes one scene operation carrying the layer's name and colour, and ONE
// undo entry removes the whole apply. The layer's carve settings (cut type,
// depth, bit) are returned as patches the ACTION applies AFTER
// applyLayerDefaultsToFreshLayers — the defaults pass would clobber them here.

import { designEntityToSceneObject, type Sketch } from '../../core/design';
import { entityDesignLayer, sketchLayers, type DesignLayer } from '../../core/design/layers';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  addLayer,
  addObject,
  bindSceneObjectToOperations,
  createArtworkOperation,
  operationArtworkCount,
  removeLayer,
  removeObject,
  type CncLayerSettings,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import {
  reusableOperationId,
  survivingObjectIds,
  type DesignApplyRecord,
} from './design-apply-record';
import { pushUndo, type MutationResult, type StateSlice } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import { repairDanglingObjectDependencies } from './object-delete-actions';

// The design layer whose settings produced a scene operation, so the action
// can stamp the carve settings onto the fresh operation after defaults run.
export type DesignCarveOperation = {
  readonly operationId: string;
  readonly layer: DesignLayer;
};

export type DesignApplyResult = Omit<MutationResult, 'selectedObjectId'> & {
  readonly selectedObjectId: string | null;
  readonly dependencyRepairs: Pick<
    ReturnType<typeof repairDanglingObjectDependencies>,
    'repairedImageMasks' | 'repairedPathTextGuides'
  >;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly carveOperations: ReadonlyArray<DesignCarveOperation>;
  // What this apply put in the scene, so the NEXT one updates it instead of
  // stacking a duplicate beside it.
  readonly applyRecord: DesignApplyRecord;
};

/**
 * Inserts every output entity of `sketch` as a scene object, one operation
 * per carve layer that contributes geometry.
 *
 * When `previous` names artwork an earlier Apply created, that artwork is
 * REPLACED: its objects are removed and its operations reused by id, so going
 * back to fix a mistake edits the part instead of duplicating it. The whole
 * replacement is one state transition, so one undo entry reverses it.
 *
 * An empty sketch clears surviving output from the previous Apply. Without
 * owned output to replace, it is a no-op and returns null.
 */
export function applyDesignSketch(
  s: StateSlice,
  sketch: Sketch,
  ids: ReadonlyArray<string>,
  previous: DesignApplyRecord | null = null,
): DesignApplyResult | null {
  const groups = buildLayerGroups(sketch, ids);
  const previousIds = survivingObjectIds(s.project.scene, previous);
  if (groups.length === 0 && previousIds.size === 0) return null;

  let scene = s.project.scene;
  // Drop the previous apply's objects BEFORE inserting, so a re-apply that
  // reuses an operation never leaves the old geometry bound to it.
  for (const objectId of previousIds) {
    scene = removeObject(scene, objectId);
  }
  const carveOperations: DesignCarveOperation[] = [];
  const inserted: SceneObject[] = [];
  const operationIdByLayerId = new Map<string, string>();
  for (const group of groups) {
    scene = insertGroup(scene, group, previous, {
      carveOperations,
      inserted,
      operationIdByLayerId,
    });
  }
  scene = dropEmptyReusedOperations(scene, previous, operationIdByLayerId);
  const removedIds = new Set(previousIds);
  for (const object of scene.objects) removedIds.delete(object.id);
  const repaired = repairDanglingObjectDependencies(removeObjectIdsFromGroups(scene, removedIds));
  scene = repaired.scene;
  const [head, ...rest] = inserted;
  return {
    project: { ...s.project, scene },
    dependencyRepairs: {
      repairedImageMasks: repaired.repairedImageMasks,
      repairedPathTextGuides: repaired.repairedPathTextGuides,
    },
    selectedObjectId: head?.id ?? null,
    additionalSelectedIds: new Set(rest.map((object) => object.id)),
    carveOperations,
    applyRecord: {
      objectIds: new Set(inserted.map((object) => object.id)),
      operationIdByLayerId,
    },
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}

// A design layer the operator deleted leaves its operation behind with no
// artwork on it. Remove exactly those — never an operation that still holds
// something, which may be the operator's own imported work.
function dropEmptyReusedOperations(
  scene: Scene,
  previous: DesignApplyRecord | null,
  reused: ReadonlyMap<string, string>,
): Scene {
  if (previous === null) return scene;
  const stillUsed = new Set(reused.values());
  let next = scene;
  for (const operationId of previous.operationIdByLayerId.values()) {
    if (stillUsed.has(operationId)) continue;
    const operation = next.layers.find((layer) => layer.id === operationId);
    if (operation === undefined) continue;
    if (operationArtworkCount(next.objects, operation) > 0) continue;
    next = removeLayer(next, operationId);
  }
  return next;
}

type LayerGroup = {
  readonly layer: DesignLayer;
  readonly objects: ReadonlyArray<SceneObject>;
};

// Ids arrive from the caller and pair with entities BY INDEX (pure core may
// not generate identity). An id list shorter than the entity list simply stops
// early rather than minting a duplicate. Grouping preserves layer order so the
// operations list reads like the layers panel.
function buildLayerGroups(sketch: Sketch, ids: ReadonlyArray<string>): ReadonlyArray<LayerGroup> {
  const layers = sketchLayers(sketch);
  const byLayer = new Map<string, SceneObject[]>();
  sketch.entities.forEach((entity, index) => {
    const id = ids[index];
    if (id === undefined) return;
    const layer = entityDesignLayer(entity, layers);
    const object = designEntityToSceneObject(entity, id, layer.color);
    if (object === null) return;
    const bucket = byLayer.get(layer.id);
    if (bucket === undefined) byLayer.set(layer.id, [object]);
    else bucket.push(object);
  });
  return layers
    .filter((layer) => (byLayer.get(layer.id)?.length ?? 0) > 0)
    .map((layer) => ({ layer, objects: byLayer.get(layer.id) ?? [] }));
}

/**
 * Stamps each fresh operation's `cnc` block with its design layer's carve
 * settings. Runs AFTER applyLayerDefaultsToFreshLayers — the WYSIWYG rule: the
 * 3D preview showed this cut type, depth, and bit, so the operation must carry
 * exactly them, while feeds/passes/tabs keep the operator's defaults. A layer
 * on "Machine bit" strips any seeded tool ids so the panel's story holds.
 */
export function applyCarveSettingsToOperations<T extends { readonly project: Project }>(
  result: T,
  carveOperations: ReadonlyArray<DesignCarveOperation>,
): T {
  if (carveOperations.length === 0) return result;
  const byOperation = new Map(carveOperations.map((op) => [op.operationId, op.layer]));
  const layers = result.project.scene.layers.map((sceneLayer) => {
    const design = byOperation.get(sceneLayer.id);
    if (design === undefined) return sceneLayer;
    const seeded = { ...DEFAULT_CNC_LAYER_SETTINGS, ...(sceneLayer.cnc ?? {}) };
    const { toolId: _seededTool, vClearToolId: _seededClear, ...base } = seeded;
    const cnc: CncLayerSettings = {
      ...base,
      cutType: design.cutType,
      depthMm: design.depthMm,
      ...(design.cutType === 'v-carve'
        ? { vCarveFlatDepthEnabled: design.vCarveFlatDepthEnabled ?? true }
        : {}),
      ...(design.toolId === undefined ? {} : { toolId: design.toolId }),
      ...(design.vClearToolId === undefined ? {} : { vClearToolId: design.vClearToolId }),
    };
    return { ...sceneLayer, cnc };
  });
  return {
    ...result,
    project: { ...result.project, scene: { ...result.project.scene, layers } },
  };
}

type InsertSink = {
  readonly carveOperations: DesignCarveOperation[];
  readonly inserted: SceneObject[];
  readonly operationIdByLayerId: Map<string, string>;
};

// The operation takes the DESIGN layer's colour rather than the palette's next
// slot: schema v3 binds by id, so colour is presentation, and the panel, the
// 2D strokes, and the main canvas must tell one story.
//
// A layer that applied before REUSES its operation: recreating it would throw
// away whatever feeds and passes the operator tuned on the main canvas and
// would suffix the name ("Layer 1 2") on every re-apply.
function insertGroup(
  scene: Scene,
  group: LayerGroup,
  previous: DesignApplyRecord | null,
  sink: InsertSink,
): Scene {
  const anchor = group.objects[0];
  if (anchor === undefined) return scene;
  const reusedId = reusableOperationId(scene, previous, group.layer.id);
  let next = scene;
  let operationId: string;
  if (reusedId === null) {
    const created = createArtworkOperation(scene, anchor, { name: group.layer.name });
    const operation = { ...created.operation, color: group.layer.color };
    operationId = operation.id;
    next = addLayer(scene, operation);
  } else {
    operationId = reusedId;
    // The design layer still owns identity: a rename or recolour in the Studio
    // must reach the operation the artwork is already bound to.
    next = {
      ...scene,
      layers: scene.layers.map((layer) =>
        layer.id === reusedId
          ? { ...layer, name: group.layer.name, color: group.layer.color }
          : layer,
      ),
    };
  }
  sink.carveOperations.push({ operationId, layer: group.layer });
  sink.operationIdByLayerId.set(group.layer.id, operationId);
  for (const object of group.objects) {
    // Objects were already built in the layer's colour by buildLayerGroups;
    // binding by id is what actually routes them to the operation (schema v3).
    const bound = bindSceneObjectToOperations(object, [operationId]);
    sink.inserted.push(bound);
    next = addObject(next, bound);
  }
  return next;
}
