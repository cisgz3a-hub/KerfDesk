// core/sim — CNC material-removal simulation (Phase H.2, ADR-098). Public API.

export {
  createRemovalGrid,
  coarsenedCellSize,
  gridCellIndex,
  gridCellOfPoint,
  DEFAULT_CELL_MM,
  MAX_GRID_CELLS,
  type RemovalGrid,
  type RemovalGridCellSizeResult,
  type RemovalGridResult,
  type RemovalGridSpec,
} from './removal-grid';
export { kernelForTool, type ToolKernel, type ToolKernelOffset } from './tool-kernels';
export { toolProfile, type ToolProfilePoint } from './tool-profile';
export {
  computeRemovalGrid,
  type ComputeRemovalGridResult,
  type ComputeRemovalOptions,
} from './stamp-toolpath';
export { downsampleRemovalGrid } from './removal-grid-display';
