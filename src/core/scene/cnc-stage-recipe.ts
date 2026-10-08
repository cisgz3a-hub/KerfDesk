import type { CncCuttingPreset } from './cnc-cutting-preset';

/** Optional independent cutting values for a secondary or wall-finishing stage. */
export type CncCuttingStage =
  | 'pocket-rough'
  | 'v-clear'
  | 'relief-finish'
  | 'relief-rest-finish'
  | 'profile-finish';

export type CncStageRecipe = {
  readonly cuttingPreset?: CncCuttingPreset;
  // Values belong to this specific cutter. A different selection does not inherit them.
  readonly toolId: string;
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly depthPerPassMm: number;
};

export const CNC_CUTTING_STAGES: ReadonlyArray<CncCuttingStage> = [
  'pocket-rough',
  'v-clear',
  'relief-finish',
  'relief-rest-finish',
  'profile-finish',
];

export function cncCuttingStageLabel(stage: CncCuttingStage): string {
  return {
    'pocket-rough': 'Pocket roughing',
    'v-clear': 'V-carve clearing',
    'relief-finish': 'Relief finishing',
    'relief-rest-finish': 'Relief rest finishing',
    'profile-finish': 'Wall finishing',
  }[stage];
}
