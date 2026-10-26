import type { Project, Scene } from '../../core/scene';
import { pruneDesignTreeOrder } from '../../core/scene/design-hierarchy-order';
import { groupsForObjectIds } from './prune-scene-groups';

export function repairRemovedProjectObjectReferences(project: Project) {
  const { scene, repairedImageMasks, repairedPathTextGuides } = repairRemovedObjectReferences(
    project.scene,
  );
  return {
    project: { ...project, scene },
    dependencyRepairs: { repairedImageMasks, repairedPathTextGuides },
  };
}

export function repairRemovedObjectReferences(scene: Scene) {
  const liveIds = new Set(scene.objects.map((object) => object.id));
  const groups = scene.groups;
  const grouped = groups?.some((group) => group.objectIds.some((id) => !liveIds.has(id)))
    ? { ...scene, groups: groupsForObjectIds(groups, liveIds) }
    : scene;
  const vectorIds = new Set(
    scene.objects.filter((object) => 'paths' in object).map((object) => object.id),
  );
  return repairDanglingObjectDependencies(pruneDesignTreeOrder(grouped), vectorIds);
}

/** Keep stored geometry when a deleted artwork supplied an image mask or text guide. */
export function repairDanglingObjectDependencies(
  scene: Scene,
  validDependencyIds?: ReadonlySet<string>,
): {
  readonly scene: Scene;
  readonly repairedImageMasks: number;
  readonly repairedPathTextGuides: number;
} {
  // Ordinary deletion admits every surviving ID. Kind-changing replacements
  // supply the vector IDs, since an image cannot act as a mask or text guide.
  const liveIds = validDependencyIds ?? new Set(scene.objects.map((object) => object.id));
  let repairedImageMasks = 0;
  let repairedPathTextGuides = 0;
  const objects = scene.objects.map((object) => {
    if (
      object.kind === 'raster-image' &&
      object.imageMaskId !== undefined &&
      !liveIds.has(object.imageMaskId)
    ) {
      repairedImageMasks += 1;
      const { imageMaskId: _removed, ...unmasked } = object;
      return unmasked;
    }
    if (
      object.kind === 'text' &&
      object.pathText !== undefined &&
      !liveIds.has(object.pathText.guideObjectId)
    ) {
      repairedPathTextGuides += 1;
      const { pathText: _removed, ...materialized } = object;
      return materialized;
    }
    return object;
  });
  return repairedImageMasks === 0 && repairedPathTextGuides === 0
    ? { scene, repairedImageMasks, repairedPathTextGuides }
    : { scene: { ...scene, objects }, repairedImageMasks, repairedPathTextGuides };
}
