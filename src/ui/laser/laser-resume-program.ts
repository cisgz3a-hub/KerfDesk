import { buildResumeProgram } from '../../core/controllers/grbl';
import type { ControllerKind } from '../../core/devices';
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

// A new laser resume is built by the GRBL-dialect builder, which finds the beam
// by M3/M4 and S words. Smoothieware programs switch it through M221 power
// scaling and Marlin programs through `M3 I` inline mode or M106 fan power, so
// the builder zeroed every power command in the rest of the job: the resumed
// job ran with the laser off (controller audit recovery-3). Until the builder
// models those dialects, a new resume on them is refused with that fact. An
// archived resume step still replays byte-for-byte, because it records what
// was actually sent.
const DIALECT_POWER_COMMANDS: Partial<Record<ControllerKind, string>> = {
  smoothieware: 'Smoothieware switches the laser through M221 power scaling',
  marlin: 'Marlin switches the laser through M3 I inline mode or M106 fan power',
};

/** Why KerfDesk cannot build a correct resumed program for this controller's
 *  programs, or null when it can. */
export function laserResumeDialectRefusal(controllerKind: ControllerKind): string | null {
  const commands = DIALECT_POWER_COMMANDS[controllerKind];
  if (commands === undefined) return null;
  return (
    `KerfDesk cannot build a correct resumed program for this controller yet: ${commands}, ` +
    'which the resume builder does not restore, so the rest of the job would run with the laser ' +
    'off. Nothing was sent. Run the job again from the start, or hide the finished parts and run ' +
    'the rest as a new job.'
  );
}
