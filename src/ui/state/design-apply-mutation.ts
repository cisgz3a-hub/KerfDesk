// design-apply-mutation — commit a Design Studio sketch into the scene
// (ADR-271, Phase N DS-5; layered by Amendment 1, DS-8).
//
// The ONE place the Studio writes to the project. Every designed entity
// becomes a scene object; entities GROUP BY CARVE LAYER, each design layer
// becomes one scene operation carrying the layer's name and colour, and ONE
// undo entry removes the whole apply. The layer's carve settings (cut type,
// depth, bit) are returned as patches the ACTION applies AFTER
// applyLayerDefaultsToFreshLayers — the defaults pass would clobber them here.

import { designEntityToSceneObject, type Sketch } from '../../core/design';
import {
  entityDesignLayer,
  sketchLayers,
  type DesignLayer,
} from '../../core/design/layers';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  addLayer,
  addObject,
  bindSceneObjectToOperations,
  createArtworkOperation,
  type CncLayerSettings,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { pushUndo, type MutationResult, type StateSlice } from './scene-mutations';

// The design layer whose settings produced a scene operation, so the action
// can stamp the carve settings onto the fresh operation after defaults run.
export type DesignCarveOperation = {
  readonly operationId: string;
  readonly layer: DesignLayer;
};

export type DesignApplyResult = MutationResult & {
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly carveOperations: ReadonlyArray<DesignCarveOperation>;
};

/**
 * Inserts every output entity of `sketch` as a scene object, one operation
 * per carve layer that contributes geometry.
 *
 * Returns null when the sketch contributes nothing — empty, or entirely
 * construction geometry. Null means "nothing applied", never an error, and the
 * caller leaves the project untouched (rule 7: inform, never refuse).
 */
export function applyDesignSketch(
  s: StateSlice,
  sketch: Sketch,
  ids: ReadonlyArray<string>,
): DesignApplyResult | null {
  const groups = buildLayerGroups(sketch, ids);
  const first = groups[0]?.objects[0];
  if (first === undefined) return null;

  let scene = s.project.scene;
  const carveOperations: DesignCarveOperation[] = [];
  const inserted: SceneObject[] = [];
  for (const group of groups) {
    scene = insertGroup(scene, group, carveOperations, inserted);
  }
  const [head, ...rest] = inserted;
  if (head === undefined) return null;
  return {
    project: { ...s.project, scene },
    selectedObjectId: head.id,
    additionalSelectedIds: new Set(rest.map((object) => object.id)),
    carveOperations,
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
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

// The operation takes the DESIGN layer's colour rather than the palette's next
// slot: schema v3 binds by id, so colour is presentation, and the panel, the
// 2D strokes, and the main canvas must tell one story.
function insertGroup(
  scene: Scene,
  group: LayerGroup,
  carveOperations: DesignCarveOperation[],
  inserted: SceneObject[],
): Scene {
  const anchor = group.objects[0];
  if (anchor === undefined) return scene;
  const created = createArtworkOperation(scene, anchor, { name: group.layer.name });
  const operation = { ...created.operation, color: group.layer.color };
  carveOperations.push({ operationId: operation.id, layer: group.layer });
  let next = addLayer(scene, operation);
  for (const object of group.objects) {
    // Objects were already built in the layer's colour by buildLayerGroups;
    // binding by id is what actually routes them to the operation (schema v3).
    const bound = bindSceneObjectToOperations(object, [operation.id]);
    inserted.push(bound);
    next = addObject(next, bound);
  }
  return next;
}
