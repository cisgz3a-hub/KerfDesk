// Position-aware removal stamping for grids with a shorter terminal cell.
// Regular grids retain stamp-toolpath's established indexed-kernel fast path.

import { partialCellCenter, partialGridHasPartialCell } from '../grid';
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
  const hasPartialX = partialGridHasPartialCell(grid, 'x');
  const hasPartialY = partialGridHasPartialCell(grid, 'y');
  stampRegularCells(grid, kernel, cx, cy, tipZ, hasPartialX, hasPartialY);
  if (hasPartialX) stampTerminalColumn(grid, kernel, cy, toolX, toolY, tipZ);
  if (hasPartialY) stampTerminalRow(grid, kernel, cx, toolX, toolY, tipZ, hasPartialX);
}

function stampRegularCells(
  grid: RemovalGrid,
  kernel: ToolKernel,
  cx: number,
  cy: number,
  tipZ: number,
  hasPartialX: boolean,
  hasPartialY: boolean,
): void {
  const terminalCol = grid.widthCells - 1;
  const terminalRow = grid.heightCells - 1;
  for (const offset of kernel.offsets) {
    const col = cx + offset.dx;
    const row = cy + offset.dy;
    if ((hasPartialX && col === terminalCol) || (hasPartialY && row === terminalRow)) continue;
    stampSurface(grid, gridCellIndex(grid, col, row), tipZ + offset.dz);
  }
}

function stampTerminalColumn(
  grid: RemovalGrid,
  kernel: ToolKernel,
  cy: number,
  toolX: number,
  toolY: number,
  tipZ: number,
): void {
  const col = grid.widthCells - 1;
  const span = kernel.surfaceCandidateSpanCells;
  for (let dy = -span; dy <= span; dy += 1) {
    stampPhysicalCell(grid, kernel, col, cy + dy, toolX, toolY, tipZ);
  }
}

function stampTerminalRow(
  grid: RemovalGrid,
  kernel: ToolKernel,
  cx: number,
  toolX: number,
  toolY: number,
  tipZ: number,
  skipTerminalColumn: boolean,
): void {
  const row = grid.heightCells - 1;
  const terminalCol = grid.widthCells - 1;
  const span = kernel.surfaceCandidateSpanCells;
  for (let dx = -span; dx <= span; dx += 1) {
    const col = cx + dx;
    if (skipTerminalColumn && col === terminalCol) continue;
    stampPhysicalCell(grid, kernel, col, row, toolX, toolY, tipZ);
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
