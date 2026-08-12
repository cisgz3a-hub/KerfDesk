// Position-aware removal stamping for grids with a shorter terminal cell.
// Regular grids retain stamp-toolpath's established indexed-kernel fast path.

import { partialCellCenter } from '../grid';
import { gridCellIndex, type RemovalGrid } from './removal-grid';
import { cuttingSurfaceDz, type ToolKernel } from './tool-kernels';

export function stampPartialToolTip(
  grid: RemovalGrid,
  kernel: ToolKernel,
  cx: number,
  cy: number,
  toolX: number,
  toolY: number,
  tipZ: number,
): void {
  const span = kernel.surfaceCandidateSpanCells;
  for (let dy = -span; dy <= span; dy += 1) {
    for (let dx = -span; dx <= span; dx += 1) {
      stampPhysicalCell(grid, kernel, cx + dx, cy + dy, toolX, toolY, tipZ);
    }
  }
}

function stampPhysicalCell(
  grid: RemovalGrid,
  kernel: ToolKernel,
  col: number,
  row: number,
  toolX: number,
  toolY: number,
  tipZ: number,
): void {
  const index = gridCellIndex(grid, col, row);
  if (index === null) return;
  const centerX = grid.originX + partialCellCenter(grid, 'x', col);
  const centerY = grid.originY + partialCellCenter(grid, 'y', row);
  const distanceMm = Math.hypot(centerX - toolX, centerY - toolY);
  if (distanceMm > kernel.radiusMm) return;
  stampSurface(grid, index, tipZ + cuttingSurfaceDz(kernel.tool, distanceMm, kernel.radiusMm));
}

function stampSurface(grid: RemovalGrid, index: number | null, surfaceZ: number): void {
  if (index === null || surfaceZ >= 0) return;
  const current = grid.depth[index] ?? 0;
  if (surfaceZ < current) grid.depth[index] = surfaceZ;
}
