import { machineKindOf, type Project } from '../../core/scene';
import {
  createLaserModeStartEvidence,
  laserModeStartSnapshotIsVerified,
  type LaserModeStartEvidence,
  type LaserModeStartSnapshot,
} from '../state/laser-mode-start-evidence';

export const LASER_MODE_UNVERIFIED_START_PROMPT =
  'Controller laser mode cannot be verified.\n\n' +
  'KerfDesk could not confirm GRBL laser mode ($32=1). With $32=0, stopping motion or losing USB can leave a commanded laser output on. Cancel, read the controller settings, and confirm $32=1 before starting. Start anyway only if you have independently confirmed it.\n\n' +
  'Start this laser job anyway?';

export function laserModeStartAcknowledgementRequired(
  project: Project,
  snapshot: LaserModeStartSnapshot,
): boolean {
  if (machineKindOf(project.machine) !== 'laser') return false;
  // A reported $32=0 used to be pre-blocked before this question was asked;
  // under frame-first it is exactly the case the acknowledgement must cover.
  return !laserModeStartSnapshotIsVerified(snapshot);
}

export function confirmLaserModeStartEvidence(
  project: Project,
  snapshot: LaserModeStartSnapshot,
  confirm: (message: string) => boolean,
): LaserModeStartEvidence | null | undefined {
  if (machineKindOf(project.machine) !== 'laser') return undefined;
  const acknowledgementRequired = laserModeStartAcknowledgementRequired(project, snapshot);
  if (acknowledgementRequired && !confirm(LASER_MODE_UNVERIFIED_START_PROMPT)) return null;
  return createLaserModeStartEvidence(snapshot, acknowledgementRequired);
}
