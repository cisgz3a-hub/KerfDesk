import type { TraceBoundary } from '../../core/trace';

export type TraceGrid = {
  readonly width: number;
  readonly height: number;
};

/** Map a boundary drawn in the imported image's pixel grid onto the capped
 * working grid used by preview and commit tracing. Omitted or invalid source
 * metadata keeps the historical working-grid interpretation for non-dialog
 * callers. Final integer clamping remains owned by normalizeTraceBoundary. */
export function traceBoundaryForWorkingGrid(
  boundary: TraceBoundary | null | undefined,
  sourceGrid: TraceGrid | null | undefined,
  workingGrid: TraceGrid,
): TraceBoundary | null {
  if (boundary == null) return null;
  if (!validGrid(sourceGrid) || !validGrid(workingGrid)) return boundary;
  const scaleX = workingGrid.width / sourceGrid.width;
  const scaleY = workingGrid.height / sourceGrid.height;
  return {
    x: boundary.x * scaleX,
    y: boundary.y * scaleY,
    width: boundary.width * scaleX,
    height: boundary.height * scaleY,
  };
}

function validGrid(grid: TraceGrid | null | undefined): grid is TraceGrid {
  return (
    grid !== null &&
    grid !== undefined &&
    Number.isFinite(grid.width) &&
    grid.width > 0 &&
    Number.isFinite(grid.height) &&
    grid.height > 0
  );
}
