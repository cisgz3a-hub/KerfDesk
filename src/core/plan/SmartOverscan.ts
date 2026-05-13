/**
 * T1-228 compatibility wrapper.
 *
 * Smart overscan is resolved during job compilation. Keep the historical plan
 * path for UI/tests that still import it directly.
 */
export {
  computeSmartOverscan,
  explainOverscan,
} from '../job/SmartOverscan';
export type {
  SmartOverscanInput,
  SmartOverscanResult,
} from '../job/SmartOverscan';
