import type { ControllerSettingsSnapshot, ReadinessSettingsCapability } from '../../core/preflight';
import type { SessionObservationStamp } from './laser-controller-observation';

export type LaserModeStartSnapshotSource = {
  readonly controllerSessionEpoch: number;
  readonly capabilities: { readonly settings: ReadinessSettingsCapability };
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly controllerSettingsObservation: SessionObservationStamp | null;
};

export type LaserModeStartSnapshot = {
  readonly controllerSessionEpoch: number;
  readonly settingsCapability: ReadinessSettingsCapability;
  readonly settingsObservation: SessionObservationStamp | null;
  readonly laserModeEnabled: boolean | undefined;
  readonly maxPowerS: number | undefined;
};

export type LaserModeStartEvidence = LaserModeStartSnapshot & {
  readonly unverifiedAcknowledged: boolean;
};

export const LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE =
  'Controller settings changed while Start was being prepared. Start again so KerfDesk can re-check $30 and $32 before sending job G-code.';

export const LASER_MODE_DISABLED_AT_START_MESSAGE =
  'Controller reports $32=0. Enable GRBL laser mode ($32=1) before starting from KerfDesk.';

const LASER_MODE_UNVERIFIED_AT_START_MESSAGE =
  'Controller laser mode is not verified for this Start. Start again and review the $32 acknowledgement before sending job G-code.';

export function captureLaserModeStartSnapshot(
  source: LaserModeStartSnapshotSource,
): LaserModeStartSnapshot {
  return {
    controllerSessionEpoch: source.controllerSessionEpoch,
    settingsCapability: source.capabilities.settings,
    settingsObservation: source.controllerSettingsObservation,
    laserModeEnabled: source.controllerSettings?.laserModeEnabled,
    maxPowerS: source.controllerSettings?.maxPowerS,
  };
}

export function createLaserModeStartEvidence(
  snapshot: LaserModeStartSnapshot,
  unverifiedAcknowledged: boolean,
): LaserModeStartEvidence {
  return { ...snapshot, unverifiedAcknowledged };
}

export function laserModeStartSnapshotIsVerified(snapshot: LaserModeStartSnapshot): boolean {
  return (
    snapshot.settingsCapability !== 'none' &&
    snapshot.laserModeEnabled === true &&
    snapshot.settingsObservation !== null &&
    snapshot.settingsObservation.sessionEpoch === snapshot.controllerSessionEpoch
  );
}

/**
 * Final wire-boundary proof for UI-originated laser Starts. The queue fence may
 * await an older settings query, so evidence accepted before that wait is valid
 * only when the same controller session and settings observation still own it.
 */
export function laserModeStartEvidenceIssue(
  current: LaserModeStartSnapshotSource,
  evidence: LaserModeStartEvidence | undefined,
): string | null {
  // Low-level store tests and controller harnesses call startJob directly.
  // Every operator-reachable Start path supplies evidence and is checked here.
  if (evidence === undefined) return null;

  // Frame-first (2026-07-17): a reported $32=0 no longer refuses the Start —
  // the Job Review acknowledgement banner carries it as the warning instead.
  const snapshot = captureLaserModeStartSnapshot(current);
  if (!sameLaserModeStartSnapshot(snapshot, evidence)) {
    return LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE;
  }
  if (!laserModeStartSnapshotIsVerified(snapshot) && !evidence.unverifiedAcknowledged) {
    return LASER_MODE_UNVERIFIED_AT_START_MESSAGE;
  }
  return null;
}

function sameLaserModeStartSnapshot(
  current: LaserModeStartSnapshot,
  evidence: LaserModeStartEvidence,
): boolean {
  return (
    current.controllerSessionEpoch === evidence.controllerSessionEpoch &&
    current.settingsCapability === evidence.settingsCapability &&
    sameObservation(current.settingsObservation, evidence.settingsObservation) &&
    current.laserModeEnabled === evidence.laserModeEnabled &&
    current.maxPowerS === evidence.maxPowerS
  );
}

function sameObservation(
  left: SessionObservationStamp | null,
  right: SessionObservationStamp | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.sessionEpoch === right.sessionEpoch && left.observedAt === right.observedAt;
}
