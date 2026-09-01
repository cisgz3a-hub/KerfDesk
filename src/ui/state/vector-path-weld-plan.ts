import { weldVectorObjects, type VectorOpError, type VectorSceneObject } from '../../core/geometry';
import {
  effectiveObjectMinPowerPercent,
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
  objectPowerScalePercent,
} from '../../core/effective-output';
import { ok, type Result } from '../../core/result';
import {
  captureLayerOperationSettings,
  createArtworkOperation,
  layerFromSubLayer,
  nextOperationColor,
  pathUsesOperation,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../../core/scene';
import {
  legacyWeldOperationColors,
  nextAvailableWeldOperationId,
  prepareUnassignedWeldObjects,
  prepareWeldObjectsForBucket,
  reservedWeldOperationIds,
  type WeldOperationBucket,
} from './vector-path-weld-bindings';

export type WeldSelectionPlan = {
  readonly object: ImportedSvg;
  readonly layers: ReadonlyArray<Layer>;
};

/** Build every geometry and operation change before Zustand publishes it. */
export function planWeldSelection(
  scene: Scene,
  objects: ReadonlyArray<VectorSceneObject>,
  resultId: string,
): Result<WeldSelectionPlan, VectorOpError> {
  const buckets = operationBuckets(scene, objects);
  const occupiedOperationIds = reservedWeldOperationIds(scene);
  const legacyColors = legacyWeldOperationColors(scene);

  const resultSeed: ImportedSvg = {
    kind: 'imported-svg',
    id: resultId,
    source: 'Welded paths',
    bounds: objects[0]?.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      mirrorX: false,
      mirrorY: false,
    },
    paths: [],
  };
  let identityScene = scene;
  const clonedLayers: Array<{ readonly sourceLayerId: string | null; readonly layer: Layer }> = [];
  const preparedObjects: VectorSceneObject[] = [
    ...prepareUnassignedWeldObjects(buckets, objects, scene, resultId, occupiedOperationIds),
  ];
  for (const bucket of buckets) {
    const sourceLayer =
      bucket.sourceLayerId === null
        ? undefined
        : scene.layers.find((layer) => layer.id === bucket.sourceLayerId);
    if (sourceLayer !== undefined && !bucket.requiresIsolation) {
      preparedObjects.push(
        ...prepareWeldObjectsForBucket(bucket, sourceLayer.bindingOperationId ?? sourceLayer.id),
      );
      continue;
    }
    const sourceName =
      bucket.sourceLayerId === null
        ? 'Welded paths'
        : `${scene.layers.find((layer) => layer.id === bucket.sourceLayerId)?.name ?? 'Operation'} (Weld)`;
    const seed = createArtworkOperation(identityScene, resultSeed, { name: sourceName });
    const seedOperation = {
      ...seed.operation,
      id: nextAvailableWeldOperationId(seed.operation.id, occupiedOperationIds),
      color: nextOperationColor([
        ...identityScene.layers,
        ...[...legacyColors].map((color) => ({ color })),
      ]),
    };
    occupiedOperationIds.add(seedOperation.id);
    const layer = cloneEffectiveLayer(bucket.effectiveLayer, seedOperation);
    clonedLayers.push({ sourceLayerId: bucket.sourceLayerId, layer });
    identityScene = { ...identityScene, layers: [...identityScene.layers, layer] };
    preparedObjects.push(...prepareWeldObjectsForBucket(bucket, layer.id));
  }

  const welded = weldVectorObjects(preparedObjects, resultId);
  if (welded.kind === 'error') return welded;
  return ok({ object: welded.value, layers: insertClonedLayers(scene.layers, clonedLayers) });
}

function operationBuckets(
  scene: Scene,
  objects: ReadonlyArray<VectorSceneObject>,
): WeldOperationBucket[] {
  const buckets: WeldOperationBucket[] = [];
  for (const layer of scene.layers) {
    for (const object of objects) {
      const effectiveLayer = bakeObjectOutput(layer, object);
      const signature = operationSignature(layer.id, effectiveLayer);
      for (const path of object.paths) {
        if (!pathUsesOperation(object, path, layer)) continue;
        const bucket = findOrCreateBucket(
          buckets,
          layer.id,
          signature,
          effectiveLayer,
          objectRequiresIsolation(object),
        );
        bucket.assignments.push({ object, path });
      }
    }
  }
  return buckets;
}

function findOrCreateBucket(
  buckets: WeldOperationBucket[],
  sourceLayerId: string | null,
  signature: string,
  effectiveLayer: Layer,
  requiresIsolation: boolean,
): WeldOperationBucket {
  const existing = buckets.find(
    (bucket) =>
      bucket.sourceLayerId === sourceLayerId &&
      bucket.signature === signature &&
      bucket.requiresIsolation === requiresIsolation,
  );
  if (existing !== undefined) return existing;
  const bucket: WeldOperationBucket = {
    sourceLayerId,
    signature,
    effectiveLayer,
    assignments: [],
    requiresIsolation,
  };
  buckets.push(bucket);
  return bucket;
}

function objectRequiresIsolation(object: VectorSceneObject): boolean {
  return object.operationOverride !== undefined || objectPowerScalePercent(object) !== 100;
}

function bakeObjectOutput(layer: Layer, object: VectorSceneObject): Layer {
  const effectiveRoot = bakePower(effectiveOperationForObject(layer, object), object);
  const subLayers = layer.subLayers.map((subLayer) => {
    const effectiveSubLayer = bakePower(
      effectiveOperationForObject(layerFromSubLayer(layer, subLayer), object),
      object,
    );
    return { ...subLayer, settings: captureLayerOperationSettings(effectiveSubLayer) };
  });
  const breakMaterialBinding =
    object.operationOverride !== undefined || objectPowerScalePercent(object) !== 100;
  const { bindingOperationId: _bindingOperationId, ...withoutRuntimeBinding } = effectiveRoot;
  if (!breakMaterialBinding) return { ...withoutRuntimeBinding, subLayers };
  const { materialBinding: _materialBinding, ...withoutLinkedMaterial } = withoutRuntimeBinding;
  return { ...withoutLinkedMaterial, subLayers };
}

function bakePower(layer: Layer, object: VectorSceneObject): Layer {
  return {
    ...layer,
    power: effectiveObjectPowerPercent(layer, object),
    minPower: effectiveObjectMinPowerPercent(layer, object),
  };
}

function operationSignature(sourceLayerId: string | null, layer: Layer): string {
  return JSON.stringify({
    sourceLayerId,
    settings: captureLayerOperationSettings(layer),
    visible: layer.visible,
    output: layer.output,
    subLayers: layer.subLayers,
    materialBinding: layer.materialBinding,
    scanOffsetCalibrationMode: layer.scanOffsetCalibrationMode,
    cnc: layer.cnc,
  });
}

function cloneEffectiveLayer(effective: Layer, seed: Layer): Layer {
  return {
    ...effective,
    id: seed.id,
    name: seed.name,
    // Explicit operation IDs distinguish the clone. The seed color is chosen
    // outside every live legacy color alias so the new layer cannot activate
    // unrelated schema-v2 artwork.
    color: seed.color,
    subLayers: effective.subLayers.map((subLayer) => ({
      ...subLayer,
      settings: { ...subLayer.settings },
    })),
  };
}

function insertClonedLayers(
  sourceLayers: ReadonlyArray<Layer>,
  clones: ReadonlyArray<{ readonly sourceLayerId: string | null; readonly layer: Layer }>,
): ReadonlyArray<Layer> {
  const result: Layer[] = [];
  for (const source of sourceLayers) {
    result.push(source);
    result.push(
      ...clones.filter((clone) => clone.sourceLayerId === source.id).map((clone) => clone.layer),
    );
  }
  result.push(
    ...clones.filter((clone) => clone.sourceLayerId === null).map((clone) => clone.layer),
  );
  return result;
}
