import {
  applyTransform,
  isClosedEnough,
  pathUsesOperation,
  type ColoredPath,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
  type Transform,
} from '../../core/scene';

type VectorSceneObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;

export type OpenFillContourGroup = {
  readonly object: VectorSceneObject;
  readonly polylines: ReadonlyArray<Polyline>;
};

export const CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM = 0.5;

export type OpenFillContourRepairSummary = {
  readonly openCount: number;
  readonly safeCount: number;
  readonly reviewedCount: number;
  readonly remainingCount: number;
};

export function selectedOpenFillContours(
  project: Project,
  selectedId: string | null,
  additional: ReadonlySet<string>,
): ReadonlyArray<OpenFillContourGroup> {
  const selectedIds = new Set([...(selectedId === null ? [] : [selectedId]), ...additional]);
  if (selectedIds.size === 0) return [];
  const fillOperations = outputFillOperations(project);
  if (fillOperations.length === 0) return [];

  return project.scene.objects
    .filter(
      (object): object is VectorSceneObject => selectedIds.has(object.id) && 'paths' in object,
    )
    .flatMap((object) => openFillContoursForObject(object, fillOperations));
}

export function selectedOpenFillContourCount(
  project: Project,
  selectedId: string | null,
  additional: ReadonlySet<string>,
): number {
  return selectedOpenFillContours(project, selectedId, additional).reduce(
    (sum, group) => sum + group.polylines.length,
    0,
  );
}

export function selectedCloseableOpenFillContourCount(
  project: Project,
  selectedId: string | null,
  additional: ReadonlySet<string>,
  toleranceMm = CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM,
): number {
  return selectedOpenFillContours(project, selectedId, additional).reduce((sum, group) => {
    if (group.object.locked === true) return sum;
    return (
      sum +
      group.polylines.filter((polyline) =>
        isCloseableOpenFillPolyline(polyline, group.object.transform, toleranceMm),
      ).length
    );
  }, 0);
}

export function selectedOpenFillContourRepairSummary(
  project: Project,
  selectedId: string | null,
  additional: ReadonlySet<string>,
  toleranceMm: number,
): OpenFillContourRepairSummary {
  const openCount = selectedOpenFillContourCount(project, selectedId, additional);
  const safeCount = selectedCloseableOpenFillContourCount(project, selectedId, additional);
  const toleratedCount =
    Number.isFinite(toleranceMm) && toleranceMm > 0
      ? selectedCloseableOpenFillContourCount(project, selectedId, additional, toleranceMm)
      : 0;
  const reviewedCount = Math.max(0, toleratedCount - safeCount);
  return {
    openCount,
    safeCount,
    reviewedCount,
    remainingCount: Math.max(0, openCount - toleratedCount),
  };
}

export function isCloseableOpenFillPolyline(
  polyline: Polyline,
  transform: Transform,
  toleranceMm = CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM,
): boolean {
  if (isClosedEnough(polyline) || polyline.points.length < 3) return false;
  const first = polyline.points[0];
  const last = polyline.points[polyline.points.length - 1];
  if (first === undefined || last === undefined) return false;
  // Measure the endpoint gap in scene millimetres, not the object's local point
  // units (px for traces, viewBox units for SVGs), so the tolerance means the
  // same physical distance regardless of the object's scale.
  const firstMm = applyTransform(first, transform);
  const lastMm = applyTransform(last, transform);
  const distanceMm = Math.hypot(firstMm.x - lastMm.x, firstMm.y - lastMm.y);
  return Number.isFinite(distanceMm) && distanceMm <= toleranceMm;
}

function outputFillOperations(project: Project): ReadonlyArray<Layer> {
  return project.scene.layers.filter((operation) => operation.output && operation.mode === 'fill');
}

function openFillContoursForObject(
  object: VectorSceneObject,
  fillOperations: ReadonlyArray<Layer>,
): ReadonlyArray<OpenFillContourGroup> {
  return object.paths.flatMap((path) => {
    if (!fillOperations.some((operation) => pathUsesOperation(object, path, operation))) return [];
    const polylines = path.polylines.filter((polyline) => !isClosedEnough(polyline));
    return polylines.length === 0 ? [] : [{ object, polylines }];
  });
}
