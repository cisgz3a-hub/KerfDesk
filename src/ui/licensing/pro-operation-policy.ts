import {
  operationIdsForObject,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { ProFeature } from './pro-features';

/** The operation choices that need Pro when created or assigned to new artwork. */
export function operationProFeature(operation: Pick<Layer, 'cnc'>): ProFeature | null {
  if (operation.cnc?.cutType === 'v-carve') return 'vcarve';
  if (operation.cnc?.cutType === 'relief-rough' || operation.cnc?.cutType === 'relief-finish')
    return 'relief';
  if (operation.cnc?.cutType === 'pocket' && operation.cnc.pocketStrategy === 'adaptive')
    return 'adaptive-clearing';
  return null;
}

/**
 * Existing desktop Pro work remains editable. Creating a Pro operation, choosing
 * it on another artwork, or copying a relief is new Pro work, including through
 * paste, recipes and operation sharing. This is never called by output or Start.
 */
export function newlyIntroducedProFeature(before: Project, after: Project): ProFeature | null {
  if (before.scene === after.scene) return null;
  const previousLayers = new Map(before.scene.layers.map((layer) => [layer.id, layer]));
  const proLayers = new Map<string, ProFeature>();
  for (const layer of after.scene.layers) {
    const feature = operationProFeature(layer);
    if (feature === null) continue;
    const previous = previousLayers.get(layer.id);
    if (previous === undefined || operationProFeature(previous) !== feature) return feature;
    proLayers.set(layer.id, feature);
  }
  return newlyIntroducedObjectFeature(before, after, proLayers);
}

function newlyIntroducedObjectFeature(
  before: Project,
  after: Project,
  proLayers: ReadonlyMap<string, ProFeature>,
): ProFeature | null {
  const previousObjects = new Map(before.scene.objects.map((object) => [object.id, object]));
  for (const object of after.scene.objects) {
    const previous = previousObjects.get(object.id);
    if (object.kind === 'relief' && previous?.kind !== 'relief') return 'relief';
    if (object === previous || proLayers.size === 0) continue;
    const feature = newlyAssignedProFeature(object, previous, before, after, proLayers);
    if (feature !== null) return feature;
  }
  return null;
}

function newlyAssignedProFeature(
  object: SceneObject,
  previous: SceneObject | undefined,
  before: Project,
  after: Project,
  proLayers: ReadonlyMap<string, ProFeature>,
): ProFeature | null {
  const previousIds = new Set(
    previous === undefined ? [] : operationIdsForObject(previous, before.scene.layers),
  );
  for (const id of operationIdsForObject(object, after.scene.layers)) {
    const feature = proLayers.get(id);
    if (feature !== undefined && !previousIds.has(id)) return feature;
  }
  return null;
}
