// core/sim — CNC material-removal simulation (Phase H.2, ADR-094). Public API.

export {
  createRemovalGrid,
  coarsenedCellSize,
  gridCellIndex,
  gridCellOfPoint,
  DEFAULT_CELL_MM,
  MAX_GRID_CELLS,
  type RemovalGrid,
  type RemovalGridSpec,
} from './removal-grid';
export { kernelForTool, type ToolKernel, type ToolKernelOffset } from './tool-kernels';
export { computeRemovalGrid, type ComputeRemovalOptions } from './stamp-toolpath';
export { downsampleRemovalGrid } from './removal-grid-display';
