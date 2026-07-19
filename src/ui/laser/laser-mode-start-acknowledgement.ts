import { machineKindOf, type Project } from '../../core/scene';
import { gcodeUsesM7 } from '../../core/preflight/m7-air-assist-readiness';
import {
  createLaserModeStartEvidence,
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
  _gcode = '',
): boolean {
  if (machineKindOf(project.machine) !== 'laser') return false;
  // Only $30/$32 verification is acknowledgeable here; M7 support is surfaced
  // as a Job Review advisory (rule 7 / ADR-228) and never gates Start.
  return !laserModeStartSnapshotIsVerified(snapshot, project.device.maxPowerS);
}

export function confirmLaserModeStartEvidence(
  project: Project,
  snapshot: LaserModeStartSnapshot,
  confirm: (message: string) => boolean,
  gcode = '',
): LaserModeStartEvidence | null | undefined {
  if (machineKindOf(project.machine) !== 'laser') return undefined;
  const acknowledgementRequired = laserModeStartAcknowledgementRequired(project, snapshot, gcode);
  if (acknowledgementRequired && !confirm(LASER_MODE_UNVERIFIED_START_PROMPT)) return null;
  return createLaserModeStartEvidence(
    snapshot,
    project.device.maxPowerS,
    gcodeUsesM7(gcode),
    acknowledgementRequired,
  );
}
