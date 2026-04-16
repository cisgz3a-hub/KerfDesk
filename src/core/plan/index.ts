/**
 * === FILE: /src/core/plan/index.ts ===
 * 
 * Purpose:    Barrel export for the Plan module.
 * Dependencies: All plan module files
 * Last updated: Phase 5, Step 18d — Raster scanline generation
 */

export * from './Plan';
export { optimizePlan, type OptimizePlanConfig } from './PlanOptimizer';
export {
  applyMachineTransform,
  type MachineOriginCorner,
  type MachineTransformOptions,
  type MachineTransformResult,
} from './MachineTransform';
export {
  applyInsideFirstOrder,
  buildContainmentTree,
  flattenContainmentTree,
  type ContainmentNode,
} from './ContainmentOrder';
export {
  generateFillScanlines,
  estimateScanlineCount,
  type ScanlineSegment,
  type FillSettings,
} from './FillGenerator';
export {
  generateRasterScanlines,
  luminanceToLaserPower,
  type RasterSegment,
  type RasterScanline,
  type RasterSettings,
} from './RasterGenerator';
export {
  orderOperations,
  orderOperationsWithMetrics,
  bboxFullyContains,
  estimateTravelMm,
  sortShapesOriginalOrder,
  type OrderableShape,
  type OperationMode,
  type ContainmentClass,
} from './OperationOrderer';
export {
  simulatePlan,
  interpolateFrames,
  extractLaserPath,
  getFrameAtTime,
  type SimulationFrame,
  type SimulationConfig,
  type SimulationResult,
} from './Simulation';
export {
  computeVelocityZones,
  velocityAt,
  scalePowerByVelocity,
  type MoveKinematics,
  type VelocityZones,
} from './VelocityProfile';
