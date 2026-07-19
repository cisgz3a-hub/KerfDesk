import { machineKindOf, type Project } from '../../core/scene';
import { gcodeUsesM7 } from '../../core/preflight/m7-air-assist-readiness';
import {
  createLaserModeStartEvidence,
  knownLaserStartContradiction,
  laserModeStartSnapshotIsVerified,
  type LaserModeStartEvidence,
  type LaserModeStartSnapshot,
} from '../state/laser-mode-start-evidence';

export const LASER_MODE_UNVERIFIED_START_PROMPT =
  'Controller requirements cannot be fully verified.\n\n' +
  'KerfDesk could not confirm, or observed a mismatch in, one or more requirements shown in Job Review: the GRBL power scale ($30), laser mode ($32=1), or M7 support when this job uses M7. Cancel and re-read the controller information when possible. Confirm only if you have independently checked every unverified requirement.\n\n' +
  'Start this laser job anyway?';

export function laserModeStartAcknowledgementRequired(
  project: Project,
  snapshot: LaserModeStartSnapshot,
  gcode = '',
): boolean {
  if (machineKindOf(project.machine) !== 'laser') return false;
  // A current build proving M7 unsupported is factual command incompatibility.
  // $30/$32 mismatches remain acknowledgeable Job Review advisories.
  if (knownLaserStartContradiction(snapshot, gcode) !== null) {
    return false;
  }
  return !laserModeStartSnapshotIsVerified(snapshot, project.device.maxPowerS, gcode);
}

export function confirmLaserModeStartEvidence(
  project: Project,
  snapshot: LaserModeStartSnapshot,
  confirm: (message: string) => boolean,
  gcode = '',
): LaserModeStartEvidence | null | undefined {
  if (machineKindOf(project.machine) !== 'laser') return undefined;
  if (knownLaserStartContradiction(snapshot, gcode) !== null) return null;
  const acknowledgementRequired = laserModeStartAcknowledgementRequired(project, snapshot, gcode);
  if (acknowledgementRequired && !confirm(LASER_MODE_UNVERIFIED_START_PROMPT)) return null;
  return createLaserModeStartEvidence(
    snapshot,
    project.device.maxPowerS,
    gcodeUsesM7(gcode),
    acknowledgementRequired,
  );
}
