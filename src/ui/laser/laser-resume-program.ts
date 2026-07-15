import { buildResumeProgram } from '../../core/controllers/grbl';

const LASER_RESUME_OPTIONS = {
  machineKind: 'laser' as const,
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
};

export function buildLaserResumeProgram(sourceGcode: string, fromLine: number) {
  return buildResumeProgram(sourceGcode, fromLine, LASER_RESUME_OPTIONS);
}
