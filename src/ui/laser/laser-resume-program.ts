import { buildResumeProgram } from '../../core/controllers/grbl';
import { scanGcodeWords, stripControllerComments } from '../../core/gcode/word-scan';
import { scanModalMotionLine, type GcodeMotionMode } from '../../core/gcode/modal-motion-line';
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
  // A Z-moving Focus Test has no absolute Z datum. After an interruption,
  // even replay from line 1 would use the interrupted height as starting focus.
  // Read the sealed bytes: zero-offset samples retain markers but never move Z.
  if (hasFocusRelativeZMotion(sourceGcode)) {
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

function hasFocusRelativeZMotion(gcode: string): boolean {
  if (
    !/(?:^|\n)\s*; Focus Test Z offset -?\d+(?:\.\d+)? mm from starting focus(?:\r?\n|$)/.test(
      gcode,
    )
  )
    return false;
  let relative = false;
  let motion: GcodeMotionMode | null = null;
  for (const raw of gcode.split('\n')) {
    const line = stripControllerComments(raw);
    const words = scanGcodeWords(line);
    for (const word of words) {
      if (word.letter === 'G' && word.value === 90) relative = false;
      if (word.letter === 'G' && word.value === 91) relative = true;
    }
    const block = scanModalMotionLine(line, motion);
    motion = block.motion;
    if (relative && block.isMotion && words.some((word) => word.letter === 'Z' && word.value !== 0))
      return true;
  }
  return false;
}
