/**
 * T1-228 compatibility wrapper.
 *
 * Operation ordering is a job-compile helper, not a planning-layer runtime
 * dependency. Keep this path for older imports while JobCompiler imports the
 * implementation from `core/job/OperationOrderer`.
 */
export {
  bboxFullyContains,
  estimateTravelMm,
  orderOperations,
  orderOperationsWithMetrics,
  sortShapesOriginalOrder,
} from '../job/OperationOrderer';
export type {
  ContainmentClass,
  OperationMode,
  OperationOrderMetrics,
  OrderableShape,
} from '../job/OperationOrderer';
