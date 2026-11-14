import {
  isClosedEnough,
  pathUsesOperation,
  type Layer,
  type Project,
  type Scene,
} from '../../core/scene';
import { isCurveClosedEnough } from '../../core/scene/polyline-closure';
import { selectionUnitCount as countSelectionUnits } from '../../core/scene/selection-units';
import { isVectorPathObject, type VectorSceneObject } from '../../core/geometry';
import { subpathCount } from '../../core/geometry/outer-shape-groups';
import { isConvertibleVector, type ConvertibleVector } from '../raster/vector-to-bitmap';
import { groupsWithinFocus } from '../state/design-hierarchy-store';
import {
  geometryToolSkippedNotice,
  geometryToolSkipReasons,
  geometryToolSources,
  type GeometryToolGuard,
} from '../state/geometry-tool-sources';
import { vectorRepairSources } from '../state/vector-repair-sources';

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

// Align and Distribute move a selected group as one object, so their "enough
// selected" checks count groups once rather than per member.
export function selectionUnitCount(
  project: Project,
  selectedIds: ReadonlyArray<string>,
  focusId: string | null = null,
): number {
  const selected = new Set(selectedIds);
  return countSelectionUnits(
    project.scene.objects.filter((object) => selected.has(object.id)),
    groupsWithinFocus(project.scene.groups ?? [], focusId),
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
// Variable text and barcodes are left out (ADR-350 Amendment 3): a bitmap of
// their stored outlines would burn the template or one stored code on every
// record, and Convert to Bitmap deletes the source that burned the value
// (tools audit T32R-P1-1).
export function selectedConvertibleVectors(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<ConvertibleVector> {
  const selection = convertibleSelection(project, selectedIds);
  return selection === null ? [] : selection.kept;
}

/** What Convert to Bitmap left out of this selection; empty when nothing. */
export function convertibleSkippedNotice(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): string {
  const selection = convertibleSelection(project, selectedIds);
  return selection === null ? '' : geometryToolSkippedNotice(selection.skipped);
}

function convertibleSelection(project: Project, selectedIds: ReadonlyArray<string>) {
  if (selectedIds.length === 0) return null;
  const selected = new Set(selectedIds);
  const convertibles = project.scene.objects.filter(
    (object): object is ConvertibleVector => selected.has(object.id) && isConvertibleVector(object),
  );
  if (convertibles.length !== selectedIds.length) return null;
  return geometryToolSources(project.scene, convertibles, 'variable');
}

/**
 * Weld, and with `guard` 'variable' Offset outlines and Dogbone: at least one
 * unlocked object the tool may rebuild, each with closed contours only.
 * Variable data, and for Weld the registration jig, are left out (ADR-350
 * Amendment 1), so a selection of only those leaves the command disabled.
 */
export function selectionCanWeld(
  project: Project,
  selectedIds: ReadonlyArray<string>,
  guard: GeometryToolGuard = 'replace',
): boolean {
  const objects = geometryToolCandidates(project, selectedIds, guard);
  return objects.length > 0 && objects.every(objectHasOnlyClosedContours);
}

function geometryToolCandidates(
  project: Project,
  selectedIds: ReadonlyArray<string>,
  guard: GeometryToolGuard,
): ReadonlyArray<VectorSceneObject> {
  const selected = new Set(selectedIds);
  const skipReason = geometryToolSkipReasons(project.scene, guard);
  return project.scene.objects.filter(
    (object): object is VectorSceneObject =>
      selected.has(object.id) &&
      object.locked !== true &&
      isVectorPathObject(object) &&
      skipReason(object) === null,
  );
}

/**
 * The operations Union Silhouette offers. Variable data and the registration
 * jig are left out of its sources (ADR-350 Amendment 2); everything else
 * selected must be an unlocked plain vector object with closed contours only.
 */
export function unionSilhouetteOperations(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<Layer> {
  const objects = vectorRepairSources(scene, selectedIds)?.kept ?? [];
  if (objects.length === 0 || !objects.every(objectHasOnlyClosedContours)) return [];
  return scene.layers.filter((operation) =>
    objects.some((object) =>
      object.paths.some((path) => pathUsesOperation(object, path, operation)),
    ),
  );
}

/** Join Paths: Union Silhouette's sources, at least one of them with an open path. */
export function selectionCanJoinPaths(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): boolean {
  const objects = vectorRepairSources(project.scene, selectedIds)?.kept ?? [];
  return objects.some((object) =>
    object.paths.some((path) =>
      path.curves === undefined
        ? path.polylines.some((polyline) => !polyline.closed && polyline.points.length > 1)
        : path.curves.some((curve) => !curve.closed && curve.segments.length > 0),
    ),
  );
}

// ADR-103 G1: booleans need a subject AND at least one clip.
export function selectionCanCombine(project: Project, selectedIds: ReadonlyArray<string>): boolean {
  const objects = geometryToolCandidates(project, selectedIds, 'replace').filter(
    isConvertibleVector,
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
      (object.kind === 'imported-svg' || object.kind === 'traced-image') &&
      object.paths.reduce((count, path) => count + subpathCount(path), 0) > 1 &&
      object.locked !== true,
  );
}

// The closed-enough rule Fill, Offset Shapes and Select Open Shapes use: a
// contour flagged open whose end returns to its start counts as closed.
function objectHasOnlyClosedContours(object: Project['scene']['objects'][number]): boolean {
  if (!isConvertibleVector(object)) return false;
  return (
    object.paths.length > 0 &&
    object.paths.every((path) => {
      if (path.curves !== undefined) {
        return path.curves.length > 0 && path.curves.every(isCurveClosedEnough);
      }
      return path.polylines.length > 0 && path.polylines.every(isClosedEnough);
    })
  );
}
