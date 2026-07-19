import type { ControllerSettingsSnapshot, ReadinessSettingsCapability } from '../../core/preflight';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import {
  evaluateM7AirAssistReadiness,
  gcodeUsesM7,
} from '../../core/preflight/m7-air-assist-readiness';
import type { SessionObservationStamp } from './laser-controller-observation';

export type LaserModeStartSnapshotSource = {
  readonly controllerSessionEpoch: number;
  readonly capabilities: { readonly settings: ReadinessSettingsCapability };
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly controllerSettingsObservation: SessionObservationStamp | null;
  readonly controllerBuildInfo?: GrblBuildInfo | null;
  readonly controllerBuildInfoObservation?: SessionObservationStamp | null;
};

export type LaserModeStartSnapshot = {
  readonly controllerSessionEpoch: number;
  readonly settingsCapability: ReadinessSettingsCapability;
  readonly settingsObservation: SessionObservationStamp | null;
  readonly laserModeEnabled: boolean | undefined;
  readonly maxPowerS: number | undefined;
  readonly controllerBuildInfo: GrblBuildInfo | null;
  readonly buildInfoObservation: SessionObservationStamp | null;
};

export type LaserModeStartEvidence = LaserModeStartSnapshot & {
  readonly expectedMaxPowerS: number;
  readonly m7Required: boolean;
  readonly unverifiedAcknowledged: boolean;
};

export const LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE =
  'The exact job changed whether M7 is required while Start was being prepared. Start again so Job Review matches the program KerfDesk will send.';

export const LASER_MODE_START_EVIDENCE_REQUIRED_MESSAGE =
  'Laser Start requires reviewed controller evidence for $30, $32, and M7 support. Start again from Job Review. No job G-code was sent.';

const LASER_REQUIREMENTS_UNVERIFIED_AT_START_MESSAGE =
  'Controller requirements are not verified for this Start. Start again and review the $30, $32, and M7 acknowledgement before sending job G-code.';

export function captureLaserModeStartSnapshot(
  source: LaserModeStartSnapshotSource,
): LaserModeStartSnapshot {
  return {
    controllerSessionEpoch: source.controllerSessionEpoch,
    settingsCapability: source.capabilities.settings,
    settingsObservation: source.controllerSettingsObservation,
    laserModeEnabled: source.controllerSettings?.laserModeEnabled,
    maxPowerS: source.controllerSettings?.maxPowerS,
    controllerBuildInfo: source.controllerBuildInfo ?? null,
    buildInfoObservation: source.controllerBuildInfoObservation ?? null,
  };
}

export function createLaserModeStartEvidence(
  snapshot: LaserModeStartSnapshot,
  expectedMaxPowerS: number,
  m7Required: boolean,
  unverifiedAcknowledged: boolean,
): LaserModeStartEvidence {
  return { ...snapshot, expectedMaxPowerS, m7Required, unverifiedAcknowledged };
}

export function laserModeStartSnapshotIsVerified(
  snapshot: LaserModeStartSnapshot,
  expectedMaxPowerS: number,
  gcode = '',
): boolean {
  const m7 = evaluateM7AirAssistReadiness(
    gcode,
    snapshot.controllerBuildInfo,
    buildInfoObservationIsCurrent(snapshot),
  );
  return (
    settingsAreVerified(snapshot, expectedMaxPowerS) &&
    (m7.kind === 'not-required' || m7.kind === 'supported')
  );
}

export function knownLaserStartContradiction(
  snapshot: LaserModeStartSnapshot,
  gcode: string,
): string | null {
  const m7 = evaluateM7AirAssistReadiness(
    gcode,
    snapshot.controllerBuildInfo,
    buildInfoObservationIsCurrent(snapshot),
  );
  return m7.kind === 'unsupported' ? m7.message : null;
}

/** Final live check shared by laser and CNC output. Settings remain review
 * advisories; only a current build that proves the exact M7 command cannot run
 * is a wire-boundary incompatibility. */
export function m7StartEvidenceIssue(
  current: LaserModeStartSnapshotSource,
  gcode: string,
): string | null {
  const snapshot = captureLaserModeStartSnapshot(current);
  const m7 = evaluateM7AirAssistReadiness(
    gcode,
    snapshot.controllerBuildInfo,
    buildInfoObservationIsCurrent(snapshot),
  );
  return m7.kind === 'unsupported' ? m7.message : null;
}

/** Final wire-boundary handoff for UI-originated laser Starts. Live $30/$32
 * changes remain review advisories under Frame-first policy. The final boundary
 * therefore proves only that the exact program still has the reviewed M7 shape,
 * that current build evidence does not prove M7 unsupported, and that unverified
 * review evidence was explicitly acknowledged. */
export function laserModeStartEvidenceIssue(
  current: LaserModeStartSnapshotSource,
  evidence: LaserModeStartEvidence | undefined,
  gcode: string,
): string | null {
  const currentM7Issue = m7StartEvidenceIssue(current, gcode);
  if (currentM7Issue !== null) return currentM7Issue;

  if (evidence === undefined) return LASER_MODE_START_EVIDENCE_REQUIRED_MESSAGE;
  if (evidence.m7Required !== gcodeUsesM7(gcode)) {
    return LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE;
  }
  if (
    !laserModeStartSnapshotIsVerified(evidence, evidence.expectedMaxPowerS, gcode) &&
    !evidence.unverifiedAcknowledged
  ) {
    return LASER_REQUIREMENTS_UNVERIFIED_AT_START_MESSAGE;
  }
  return null;
}

function settingsAreVerified(snapshot: LaserModeStartSnapshot, expectedMaxPowerS: number): boolean {
  return (
    settingsObservationIsCurrent(snapshot) &&
    snapshot.laserModeEnabled === true &&
    snapshot.maxPowerS === expectedMaxPowerS
  );
}

function settingsObservationIsCurrent(snapshot: LaserModeStartSnapshot): boolean {
  return (
    snapshot.settingsCapability !== 'none' &&
    snapshot.settingsObservation !== null &&
    snapshot.settingsObservation.sessionEpoch === snapshot.controllerSessionEpoch
  );
}

function buildInfoObservationIsCurrent(snapshot: LaserModeStartSnapshot): boolean {
  return (
    snapshot.buildInfoObservation !== null &&
    snapshot.buildInfoObservation.sessionEpoch === snapshot.controllerSessionEpoch
  );
}
