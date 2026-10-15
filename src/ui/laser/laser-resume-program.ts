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
  // A Focus Test has no absolute Z datum in its program. After an interruption,
  // even replay from line 1 would use the interrupted height as starting focus.
  // The emitted marker travels with the sealed artifact, unlike current UI state.
  if (
    /(?:^|\n)\s*; Focus Test Z offset -?\d+(?:\.\d+)? mm from starting focus(?:\r?\n|$)/.test(
      sourceGcode,
    )
  ) {
    return {
      kind: 'error' as const,
      reason:
        'Focus Test recovery cannot reconstruct the original starting Z focus after interruption, including restart from line 1. Restore the physical starting focus, then review the whole job through ordinary Frame and Start.',
    };
  }
  return buildResumeProgram(sourceGcode, fromLine, {
    ...LASER_RESUME_OPTIONS,
    laserTransform: transform,
    laserDialect: laserResumeDialectForDevice(device),
  });
}
