import { registrationBoxBounds } from '../../io/gcode/prepare-output';
import { cncSideInputScene, cncSideOutputProject } from '../../core/cnc/cnc-two-sided-setup';
import {
  findRegistrationBoxes,
  sceneObjectUsesOperation,
  type OutputScope,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { Scene } from '../../core/scene/scene';
import type { JobPlacementSettings } from '../../core/job';
import { reliefAuthoringLinkIds } from '../../core/relief/relief-authoring-link-ids';

/** Match output membership while retaining the actual placement dependencies. */
export function frameSpatialOutputScene(
  project: Project,
  outputScope: OutputScope,
  placement: JobPlacementSettings,
): Scene {
  const scene = project.scene;
  const scope = selectedSpatialScope(project, outputScope, placement);
  const sideIds = activeSideIds(project);
  if (sideIds === undefined && scope === undefined) return scene;
  const ids = spatialArtworkIds(scene, sideIds, scope);
  retainSpatialReliefProjections(scene, ids);
  for (const object of scene.outputDependencies ?? []) ids.add(object.id);
  retainSpatialImageMasks(scene, ids);
  retainSpatialRegistrationBoxes(scene, ids, sideIds, placement);
  retainSpatialReliefLinks(
    new Map(
      [...scene.objects, ...(scene.outputDependencies ?? [])].map((object) => [object.id, object]),
    ),
    ids,
  );
  return {
    ...scene,
    objects: scene.objects.filter((object) => ids.has(object.id)),
    ...(scene.artworkOrder === undefined
      ? {}
      : { artworkOrder: scene.artworkOrder.filter((id) => ids.has(id)) }),
  };
}

function selectedSpatialScope(
  project: Project,
  scope: OutputScope,
  placement: JobPlacementSettings,
): OutputScope | undefined {
  if (!scope.cutSelectedGraphics) return undefined;
  if (placement.startFrom === 'absolute' || scope.useSelectionOrigin) return scope;
  return hasRegistrationAnchor(project) ? scope : undefined;
}

function hasRegistrationAnchor(project: Project): boolean {
  // Match the compiler's registration-anchor precedence. An inactive fixture or
  // a CNC profile collapsed by its tool cannot supply that anchor.
  const scene = cncSideInputScene(project, project.scene);
  return (
    findRegistrationBoxes(scene).length > 0 &&
    registrationBoxBounds(cncSideOutputProject(project, scene)) !== null
  );
}

function activeSideIds(project: Project): ReadonlySet<string> | undefined {
  const side = project.machine?.kind === 'cnc' ? project.cncSetup?.twoSided : undefined;
  if (side === undefined) return undefined;
  return new Set(side.activeSide === 'A' ? side.sideAObjectIds : side.sideBObjectIds);
}

function spatialArtworkIds(
  scene: Scene,
  sideIds: ReadonlySet<string> | undefined,
  scope: OutputScope | undefined,
): Set<string> {
  const selectedIds = scope === undefined ? undefined : new Set(scope.selectedObjectIds);
  return new Set(
    scene.objects
      .filter(
        (object) =>
          (sideIds === undefined || sideIds.has(object.id)) &&
          (selectedIds === undefined || selectedIds.has(object.id)),
      )
      .map((object) => object.id),
  );
}

function retainSpatialImageMasks(scene: Scene, ids: Set<string>): void {
  for (const object of scene.objects) {
    if (ids.has(object.id) && object.kind === 'raster-image' && object.imageMaskId !== undefined) {
      ids.add(object.imageMaskId);
    }
  }
}

function retainSpatialRegistrationBoxes(
  scene: Scene,
  ids: Set<string>,
  sideIds: ReadonlySet<string> | undefined,
  placement: JobPlacementSettings,
): void {
  // Registration fixtures own a relative anchor during artwork-only output.
  if (placement.startFrom === 'absolute') return;
  for (const object of findRegistrationBoxes(scene)) {
    if (sideIds === undefined || sideIds.has(object.id)) ids.add(object.id);
  }
}

function retainSpatialReliefProjections(scene: Scene, ids: Set<string>): void {
  for (const layer of scene.layers) {
    const projection = layer.output ? layer.cnc?.reliefProjection : undefined;
    if (
      projection !== undefined &&
      scene.objects.some((object) => ids.has(object.id) && sceneObjectUsesOperation(object, layer))
    ) {
      ids.add(projection.reliefObjectId);
    }
  }
}

function retainSpatialReliefLinks(
  objects: ReadonlyMap<string, SceneObject>,
  ids: Set<string>,
): void {
  const pending = [...ids];
  for (const id of pending) {
    const object = objects.get(id);
    if (object?.kind !== 'relief' || object.reliefSource.kind !== 'heightfield-v1') continue;
    if (!('reliefAuthoring' in object) || object.reliefAuthoring === undefined) continue;
    for (const linkedId of reliefAuthoringLinkIds(object.reliefAuthoring)) {
      if (ids.has(linkedId)) continue;
      ids.add(linkedId);
      pending.push(linkedId);
    }
  }
}
