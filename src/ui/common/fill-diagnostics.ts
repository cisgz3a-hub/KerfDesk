import type { Project } from '../../core/scene';
import {
  CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM,
  isCloseableOpenFillPolyline,
  openFillContours,
  type OpenFillContourGroup,
} from '../../core/job/open-fill-contours';

export {
  CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM,
  isCloseableOpenFillPolyline,
  type OpenFillContourGroup,
} from '../../core/job/open-fill-contours';

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
  return selectedIds.size === 0 ? [] : openFillContours(project.scene, selectedIds);
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
  return closeableCount(selectedOpenFillContours(project, selectedId, additional), toleranceMm);
}

export function selectedOpenFillContourRepairSummary(
  project: Project,
  selectedId: string | null,
  additional: ReadonlySet<string>,
  toleranceMm: number,
): OpenFillContourRepairSummary {
  const groups = selectedOpenFillContours(project, selectedId, additional);
  const openCount = groups.reduce((sum, group) => sum + group.polylines.length, 0);
  const safeCount = closeableCount(groups, CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM);
  const toleratedCount = closeableCount(groups, toleranceMm);
  return {
    openCount,
    safeCount,
    reviewedCount: Math.max(0, toleratedCount - safeCount),
    remainingCount: Math.max(0, openCount - toleratedCount),
  };
}

function closeableCount(groups: ReadonlyArray<OpenFillContourGroup>, toleranceMm: number): number {
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) return 0;
  return groups.reduce((sum, group) => {
    if (group.object.locked === true || !group.repairable) return sum;
    return (
      sum +
      group.polylines.filter((polyline) =>
        isCloseableOpenFillPolyline(polyline, group.object.transform, toleranceMm),
      ).length
    );
  }, 0);
}
