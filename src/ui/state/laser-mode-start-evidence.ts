import type { ControllerSettingsSnapshot, ReadinessSettingsCapability } from '../../core/preflight';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import {
  isOperatorPowerScaleStatement,
  type OperatorPowerScaleStatement,
} from '../../core/devices/power-scale-statement';
import { gcodeUsesM7 } from '../../core/preflight/m7-air-assist-readiness';
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
  /** Present only when the operator's recorded statement stood in for a
   * power scale the firmware does not report (ADR-095 Amendment 1). It is the
   * operator's word, archived as such, and never a KerfDesk verification. */
  readonly operatorStatedPowerScale?: OperatorPowerScaleStatement;
};

export const LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE =
  'The exact job changed whether M7 is required while Start was being prepared. Start again so Job Review matches the program KerfDesk will send.';

export const LASER_MODE_START_EVIDENCE_REQUIRED_MESSAGE =
  'Laser Start requires reviewed $30/$32 controller evidence and an exact binding to whether this program uses M7. Start again from Job Review. No job G-code was sent.';

const LASER_REQUIREMENTS_UNVERIFIED_AT_START_MESSAGE =
  'Controller settings are not verified for this Start. Start again and review the $30/$32 acknowledgement before sending job G-code.';

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
  operatorStatedPowerScale?: OperatorPowerScaleStatement,
): LaserModeStartEvidence {
  return {
    ...snapshot,
    expectedMaxPowerS,
    m7Required,
    unverifiedAcknowledged,
    ...(operatorStatedPowerScale === undefined ? {} : { operatorStatedPowerScale }),
  };
}

/** Whether the evidence carries an operator statement that covers it: made
 * for the Full-power S this Start expects, on a firmware that reports no
 * settings. A statement beside a settings report covers nothing. */
export function operatorStatedPowerScaleCovers(evidence: LaserModeStartEvidence): boolean {
  const statement = evidence.operatorStatedPowerScale;
  return (
    statement !== undefined &&
    isOperatorPowerScaleStatement(statement) &&
    evidence.settingsCapability === 'none' &&
    statement.maxPowerS === evidence.expectedMaxPowerS
  );
}

export function laserModeStartSnapshotIsVerified(
  snapshot: LaserModeStartSnapshot,
  expectedMaxPowerS: number,
): boolean {
  return settingsAreVerified(snapshot, expectedMaxPowerS);
}

/** Final wire-boundary handoff for UI-originated laser Starts. Live $30/$32 and
 * M7 support remain review advisories under Frame-first policy. The final
 * boundary therefore proves only that the exact program still has the reviewed
 * M7 shape and that unverified review evidence was explicitly acknowledged, or
 * is covered by the operator's recorded power-scale statement. */
export function laserModeStartEvidenceIssue(
  evidence: LaserModeStartEvidence | undefined,
  gcode: string,
): string | null {
  if (evidence === undefined) return LASER_MODE_START_EVIDENCE_REQUIRED_MESSAGE;
  if (evidence.m7Required !== gcodeUsesM7(gcode)) {
    return LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE;
  }
  if (
    !laserModeStartSnapshotIsVerified(evidence, evidence.expectedMaxPowerS) &&
    !evidence.unverifiedAcknowledged &&
    !operatorStatedPowerScaleCovers(evidence)
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
