import {
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type Layer,
  type Scene,
} from '../../core/scene';

export type BlockingCncSecondaryToolReference = {
  readonly layerId: string;
  readonly layerColor: string;
  readonly role: 'V-carve clearing' | 'relief finishing' | 'pocket roughing';
};

/** References whose stage is active and whose selector is reachable in the
 * operation editor. Dormant hidden fields are cleanup candidates, not reasons
 * to trap a custom bit in the library. */
export function blockingCncSecondaryToolReferences(
  scene: Scene,
  toolId: string,
): ReadonlyArray<BlockingCncSecondaryToolReference> {
  const references: BlockingCncSecondaryToolReference[] = [];
  for (const layer of scene.layers) {
    const settings = layer.cnc;
    if (settings === undefined) continue;
    if (settings.vClearToolId === toolId && settings.cutType === 'v-carve') {
      references.push(reference(layer, 'V-carve clearing'));
    }
    if (
      settings.pocketRoughToolId === toolId &&
      settings.cutType === 'pocket' &&
      settings.pocketStrategy !== 'adaptive'
    ) {
      references.push(reference(layer, 'pocket roughing'));
    }
    if (settings.reliefFinishToolId === toolId && layerHasReliefObject(scene, layer)) {
      references.push(reference(layer, 'relief finishing'));
    }
  }
  return references;
}

/** Removes only hidden/inactive references. Callers must refuse deletion first
 * when blockingCncSecondaryToolReferences returns a result. */
export function sceneWithoutDormantCncSecondaryToolReferences(scene: Scene, toolId: string): Scene {
  let changed = false;
  const layers = scene.layers.map((layer) => {
    const settings = layer.cnc;
    if (settings === undefined) return layer;
    const next = withoutDormantReferences(scene, layer, settings, toolId);
    if (next === settings) return layer;
    changed = true;
    return { ...layer, cnc: next };
  });
  return changed ? { ...scene, layers } : scene;
}

function withoutDormantReferences(
  scene: Scene,
  layer: Layer,
  settings: CncLayerSettings,
  toolId: string,
): CncLayerSettings {
  let next = settings;
  if (next.vClearToolId === toolId && next.cutType !== 'v-carve') {
    const { vClearToolId: _removed, ...rest } = next;
    next = rest;
  }
  if (
    next.pocketRoughToolId === toolId &&
    (next.cutType !== 'pocket' || next.pocketStrategy === 'adaptive')
  ) {
    const { pocketRoughToolId: _removed, ...rest } = next;
    next = rest;
  }
  if (next.reliefFinishToolId === toolId && !layerHasReliefObject(scene, layer)) {
    const { reliefFinishToolId: _removed, ...rest } = next;
    next = rest;
  }
  return next;
}

function layerHasReliefObject(scene: Scene, layer: Layer): boolean {
  return scene.objects.some(
    (object) => object.kind === 'relief' && sceneObjectUsesOperation(object, layer),
  );
}

function reference(
  layer: Layer,
  role: BlockingCncSecondaryToolReference['role'],
): BlockingCncSecondaryToolReference {
  return { layerId: layer.id, layerColor: layer.color, role };
}
