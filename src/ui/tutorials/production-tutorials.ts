import { CALIBRATION_TUTORIALS } from './calibration-tutorials';
import { PLACEMENT_TUTORIALS } from './placement-tutorials';
import { PRODUCTION_GENERATOR_TUTORIALS } from './production-generator-tutorials';
import { PRODUCTION_TOOL_TUTORIALS } from './production-tool-tutorials';
import type { Tutorial } from './tutorial-types';

export const PRODUCTION_TUTORIALS: readonly Tutorial[] = [
  ...PRODUCTION_GENERATOR_TUTORIALS,
  ...CALIBRATION_TUTORIALS,
  ...PLACEMENT_TUTORIALS,
  ...PRODUCTION_TOOL_TUTORIALS,
];
