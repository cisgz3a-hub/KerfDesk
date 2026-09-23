import { buildResumeProgram } from '../../core/controllers/grbl';
import {
  LASER_RESUME_TRANSFORM_VERSION,
  type LaserResumeTransformVersion,
} from '../../core/controllers/grbl/resume-program';

const LASER_RESUME_OPTIONS = {
  machineKind: 'laser' as const,
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
};

/** Builds a laser resume with the current transform, or with the transform an
 * archived resume step recorded when its saved bytes are being reproduced. */
export function buildLaserResumeProgram(
  sourceGcode: string,
  fromLine: number,
  transform: LaserResumeTransformVersion = LASER_RESUME_TRANSFORM_VERSION,
) {
  return buildResumeProgram(sourceGcode, fromLine, {
    ...LASER_RESUME_OPTIONS,
    laserTransform: transform,
  });
}
