import { sceneObjectHasVisibleLayer, type Project, type Scene } from '../../../core/scene';

export function jigSelectionForHit(
  scene: Scene,
  hitId: string,
  selectedIds: ReadonlySet<string>,
  additive: boolean,
): ReadonlySet<string> {
  const groupIds = new Set([hitId]);
  // Resolve overlapping groups as well as the usual single group.
  let previousSize = 0;
  while (previousSize !== groupIds.size) {
    previousSize = groupIds.size;
    for (const group of scene.groups ?? []) {
      if (group.objectIds.some((id) => groupIds.has(id))) {
        for (const id of group.objectIds) groupIds.add(id);
      }
    }
  }
  const selectable = scene.objects.filter(
    (object) => object.locked !== true && sceneObjectHasVisibleLayer(scene, object),
  );
  const next = new Set(additive || selectedIds.has(hitId) ? selectedIds : []);
  const removing = additive && selectedIds.has(hitId);
  for (const object of selectable) {
    if (!groupIds.has(object.id)) continue;
    if (removing) next.delete(object.id);
    else next.add(object.id);
  }
  return new Set(selectable.filter((object) => next.has(object.id)).map((object) => object.id));
}

export function moveJigSelection(
  project: Project,
  selectedIds: ReadonlySet<string>,
  dx: number,
  dy: number,
): Project {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return project;
  let changed = false;
  const objects = project.scene.objects.map((object) => {
    if (
      !selectedIds.has(object.id) ||
      object.locked === true ||
      !sceneObjectHasVisibleLayer(project.scene, object)
    )
      return object;
    changed = true;
    return {
      ...object,
      transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
    };
  });
  return changed ? { ...project, scene: { ...project.scene, objects } } : project;
}
