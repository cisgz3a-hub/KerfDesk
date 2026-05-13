/**
 * T1-228 compatibility wrapper.
 *
 * Scanning-offset calibration is part of job/layer settings and is shared
 * before planning. Keep the historical plan path for existing callers.
 */
export {
  EMPTY_OFFSET_TABLE,
  applyScanOffset,
  interpolateOffset,
  suggestedDefaultTable,
} from '../job/ScanningOffset';
export type {
  ScanningOffsetPoint,
  ScanningOffsetTable,
} from '../job/ScanningOffset';
