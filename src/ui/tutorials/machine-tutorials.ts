import { CNC_DETAIL_TUTORIALS } from './cnc-detail-tutorials';
import { CNC_TUTORIALS } from './cnc-tutorials';
import { CNC_UTILITY_TUTORIALS } from './cnc-utility-tutorials';
import { CONTROLLER_TUTORIALS } from './controller-tutorials';
import { LASER_TUTORIALS } from './laser-tutorials';
import { MACHINE_SETUP_TUTORIALS } from './machine-setup-tutorials';
import { RUN_TUTORIALS } from './run-tutorials';
import type { Tutorial } from './tutorial-types';

export const MACHINE_TUTORIALS: readonly Tutorial[] = [
  ...LASER_TUTORIALS,
  ...CNC_TUTORIALS,
  ...CNC_DETAIL_TUTORIALS,
  ...CNC_UTILITY_TUTORIALS,
  ...MACHINE_SETUP_TUTORIALS,
  ...RUN_TUTORIALS,
  ...CONTROLLER_TUTORIALS,
];
