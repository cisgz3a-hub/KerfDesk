import type { Project } from '../../core/scene';
import { isConvertibleVector } from '../raster/vector-to-bitmap';

export function selectedObject(project: Project, selectedObjectId: string | null) {
  if (selectedObjectId === null) return null;
  return project.scene.objects.find((object) => object.id === selectedObjectId) ?? null;
}

export function selectedObjectIds(
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  return [...(selectedObjectId === null ? [] : [selectedObjectId]), ...additionalSelectedIds];
}

export function selectionTouchesGroup(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): boolean {
  const selected = new Set(selectedIds);
  return (project.scene.groups ?? []).some((group) =>
    group.objectIds.some((objectId) => selected.has(objectId)),
  );
}

export function selectionHasUnlockedObject(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): boolean {
  const selected = new Set(selectedIds);
  return project.scene.objects.some((object) => selected.has(object.id) && object.locked !== true);
}

export function selectionHasVectorObject(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): boolean {
  const selected = new Set(selectedIds);
  return project.scene.objects.some(
    (object) => selected.has(object.id) && isConvertibleVector(object),
  );
}

export function selectionHasUnlockedVectorObject(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): boolean {
  const selected = new Set(selectedIds);
  return project.scene.objects.some(
    (object) => selected.has(object.id) && object.locked !== true && isConvertibleVector(object),
  );
}

export function selectionCanWeld(project: Project, selectedIds: ReadonlyArray<string>): boolean {
  const selected = new Set(selectedIds);
  const objects = project.scene.objects.filter(
    (object) => selected.has(object.id) && object.locked !== true && isConvertibleVector(object),
  );
  return objects.length > 0 && objects.every(objectHasOnlyClosedContours);
}

export function selectionCanBreakApart(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): boolean {
  const selected = new Set(selectedIds);
  return project.scene.objects.some(
    (object) =>
      selected.has(object.id) &&
      object.kind === 'imported-svg' &&
      object.paths.reduce((count, path) => count + path.polylines.length, 0) > 1 &&
      object.locked !== true,
  );
}

function objectHasOnlyClosedContours(object: Project['scene']['objects'][number]): boolean {
  if (!isConvertibleVector(object)) return false;
  return (
    object.paths.length > 0 &&
    object.paths.every(
      (path) =>
        path.polylines.length > 0 &&
        path.polylines.every((polyline) => polyline.closed && polyline.points.length >= 3),
    )
  );
}
