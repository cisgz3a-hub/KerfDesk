import { buildResumeProgram } from '../../core/controllers/grbl';
import {
  LASER_RESUME_TRANSFORM_VERSION,
  type LaserResumeTransformVersion,
} from '../../core/controllers/grbl/resume-program';
import {
  laserResumeDialectForDevice,
  type LaserResumeDevice,
} from '../../core/controllers/grbl/laser-resume-dialect';

const LASER_RESUME_OPTIONS = {
  machineKind: 'laser' as const,
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
};

/** Builds a laser resume with the current transform, or with the transform an
 * archived resume step recorded when its saved bytes are being reproduced.
 * `device` is the profile the program was emitted with: its controller decides
 * the power commands the resume re-arms the beam with (ADR-364). */
export function buildLaserResumeProgram(
  sourceGcode: string,
  fromLine: number,
  device: LaserResumeDevice,
  transform: LaserResumeTransformVersion = LASER_RESUME_TRANSFORM_VERSION,
) {
  return buildResumeProgram(sourceGcode, fromLine, {
    ...LASER_RESUME_OPTIONS,
    laserTransform: transform,
    laserDialect: laserResumeDialectForDevice(device),
  });
}
