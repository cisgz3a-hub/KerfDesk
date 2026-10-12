import {
  operationIdsForObject,
  type Layer,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import { objectVariableTemplate } from '../../core/variables/object-variable-template';
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
  const introducedOperation = newlyIntroducedProOperationFeature(before, after);
  if (introducedOperation !== null) return introducedOperation;
  return newlyIntroducedObjectFeature(before, after, proLayerFeatures(after));
}

/**
 * Geometry edits may replace artwork IDs while preserving the same operations.
 * Weld uses this narrower check because only its isolated effective-operation
 * clones introduce independent Pro work. Without Pro, changing the artwork of
 * existing Pro work still asks (ADR-592).
 */
export function newlyIntroducedProOperationFeature(
  before: Project,
  after: Project,
): ProFeature | null {
  if (before.scene === after.scene) return null;
  const previousLayers = new Map(before.scene.layers.map((layer) => [layer.id, layer]));
  for (const layer of after.scene.layers) {
    const feature = operationProFeature(layer);
    if (feature === null) continue;
    const previous = previousLayers.get(layer.id);
    if (previous === undefined || operationProFeature(previous) !== feature) return feature;
  }
  return changedProArtworkFeature(before, after);
}

/**
 * Free keeps existing Pro work's settings editable, not its artwork (ADR-592):
 * new or changed outlines on artwork bound to a V-carve, relief or adaptive
 * operation, or a relief's changed height data, need Pro. Moving, scaling and
 * operation settings stay free; removing Pro work is always allowed.
 */
export function changedProArtworkFeature(before: Project, after: Project): ProFeature | null {
  return changedVariableArtworkFeature(before, after) ?? changedSceneArtworkFeature(before, after);
}

function changedVariableArtworkFeature(before: Project, after: Project): ProFeature | null {
  if (
    before.variables?.csv !== after.variables?.csv &&
    JSON.stringify(before.variables?.csv) !== JSON.stringify(after.variables?.csv)
  ) {
    // Variable artwork is re-evaluated at output. Replacing its data authors new
    // outlines even when the stored scene/paths stay the same. Record and serial
    // progression within an admitted dataset remain Free.
    const proLayers = proLayerFeatures(after);
    for (const object of after.scene.objects) {
      if (!objectVariableTemplate(object)?.tokens.some((token) => token.kind === 'csv')) continue;
      const feature = boundProFeature(object, after, proLayers);
      if (feature !== null) return feature;
    }
  }
  return null;
}

function changedSceneArtworkFeature(before: Project, after: Project): ProFeature | null {
  if (before.scene === after.scene) return null;
  const proLayers = proLayerFeatures(after);
  const previousObjects = new Map(before.scene.objects.map((object) => [object.id, object]));
  for (const object of after.scene.objects) {
    const previous = previousObjects.get(object.id);
    if (object === previous) continue;
    if (object.kind === 'relief') {
      if (previous?.kind !== 'relief' || !sameReliefSource(previous, object)) return 'relief';
      continue;
    }
    if (proLayers.size === 0) continue;
    const feature = boundProFeature(object, after, proLayers);
    if (feature !== null && (previous === undefined || !sameArtwork(previous, object)))
      return feature;
  }
  return null;
}

function proLayerFeatures(project: Project): ReadonlyMap<string, ProFeature> {
  const proLayers = new Map<string, ProFeature>();
  for (const layer of project.scene.layers) {
    const feature = operationProFeature(layer);
    if (feature !== null) proLayers.set(layer.id, feature);
  }
  return proLayers;
}

function boundProFeature(
  object: SceneObject,
  project: Project,
  proLayers: ReadonlyMap<string, ProFeature>,
): ProFeature | null {
  for (const id of operationIdsForObject(object, project.scene.layers)) {
    const feature = proLayers.get(id);
    if (feature !== undefined) return feature;
  }
  return null;
}

function sameArtwork(previous: SceneObject, next: SceneObject): boolean {
  const previousTemplate = objectVariableTemplate(previous);
  const nextTemplate = objectVariableTemplate(next);
  if (
    previousTemplate !== nextTemplate &&
    JSON.stringify(previousTemplate) !== JSON.stringify(nextTemplate)
  )
    return false;
  if (!('paths' in previous) || !('paths' in next)) return previous.kind === next.kind;
  return (
    previous.paths === next.paths || JSON.stringify(previous.paths) === JSON.stringify(next.paths)
  );
}

function sameReliefSource(previous: ReliefObject, next: ReliefObject): boolean {
  const a = previous.reliefSource;
  const b = next.reliefSource;
  if (a === b) return true;
  if (a.kind === 'heightfield-v1' && b.kind === 'heightfield-v1')
    return a.samplesBase64 === b.samplesBase64 && a.inclusionMask === b.inclusionMask;
  return (
    a.kind === 'legacy-mesh' && b.kind === 'legacy-mesh' && a.meshPositions === b.meshPositions
  );
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
