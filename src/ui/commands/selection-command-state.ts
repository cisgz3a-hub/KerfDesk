import type { Project } from '../../core/scene';
import {
  isVectorPathObject,
  vectorObjectOutputMetadataCompatible,
  type VectorSceneObject,
} from '../../core/geometry';
import { isConvertibleVector, type ConvertibleVector } from '../raster/vector-to-bitmap';

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

// Convert to Bitmap operates on the whole selection, merging it into ONE
// bitmap like LightBurn (ADR-029 amendment ii). Enabled only when every
// selected object is a convertible vector — a mixed selection (e.g. a raster
// among the vectors) stays disabled rather than converting an ambiguous
// subset. Returns the convertibles in scene order (deterministic render
// order), or an empty array when the selection doesn't qualify.
export function selectedConvertibleVectors(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<ConvertibleVector> {
  if (selectedIds.length === 0) return [];
  const selected = new Set(selectedIds);
  const convertibles = project.scene.objects.filter(
    (object): object is ConvertibleVector => selected.has(object.id) && isConvertibleVector(object),
  );
  return convertibles.length === selectedIds.length ? convertibles : [];
}

export function selectionCanWeld(project: Project, selectedIds: ReadonlyArray<string>): boolean {
  const selected = new Set(selectedIds);
  const objects = project.scene.objects.filter(
    (object): object is VectorSceneObject =>
      selected.has(object.id) && object.locked !== true && isVectorPathObject(object),
  );
  return (
    objects.length > 0 &&
    vectorObjectOutputMetadataCompatible(objects) &&
    objects.every(objectHasOnlyClosedContours)
  );
}

// ADR-103 G1: booleans need a subject AND at least one clip.
export function selectionCanCombine(project: Project, selectedIds: ReadonlyArray<string>): boolean {
  const selected = new Set(selectedIds);
  const objects = project.scene.objects.filter(
    (object) => selected.has(object.id) && object.locked !== true && isConvertibleVector(object),
  );
  return objects.length >= 2 && objects.every(objectHasOnlyClosedContours);
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
