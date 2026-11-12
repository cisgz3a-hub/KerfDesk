import { machineKindOf, type Project } from '../../core/scene';
import {
  standingPowerScaleStatement,
  unreportedPowerScaleFirmware,
  unreportedPowerScaleStartPrompt,
  type OperatorPowerScaleStatement,
} from '../../core/devices/power-scale-statement';
import { gcodeUsesM7 } from '../../core/preflight/m7-air-assist-readiness';
import {
  createLaserModeStartEvidence,
  laserModeStartSnapshotIsVerified,
  type LaserModeStartEvidence,
  type LaserModeStartSnapshot,
} from '../state/laser-mode-start-evidence';

export const LASER_MODE_UNVERIFIED_START_PROMPT =
  'Controller settings cannot be fully verified.\n\n' +
  'KerfDesk could not confirm, or observed a mismatch in, the GRBL power scale ($30) or laser mode ($32=1) shown in Job Review. M7 capability remains a separate Job Review advisory and never requires this acknowledgement. Cancel and use the fix Job Review offers (Send $32=1 when laser mode is off) when possible. Confirm only if you have independently checked each unverified setting.\n\n' +
  'Start this laser job anyway?';

/** What a laser Start has to go on for the controller's power scale and laser
 * mode (ADR-095 Amendment 1):
 * - `verified`: this session's settings report agrees with the profile;
 * - `operator-stated`: the firmware reports no power scale, and the operator
 *   recorded that they checked it for this profile. That is the operator's
 *   word. It needs no click, and it is never called verified;
 * - `unverified`: the operator confirms `prompt` before this Start. */
export type LaserModeStartReview =
  | { readonly kind: 'verified' }
  | { readonly kind: 'operator-stated'; readonly statement: OperatorPowerScaleStatement }
  | { readonly kind: 'unverified'; readonly prompt: string };

/** Null for a machine that is not a laser. */
export function laserModeStartReview(
  project: Project,
  snapshot: LaserModeStartSnapshot,
): LaserModeStartReview | null {
  if (machineKindOf(project.machine) !== 'laser') return null;
  if (laserModeStartSnapshotIsVerified(snapshot, project.device.maxPowerS)) {
    return { kind: 'verified' };
  }
  // Only a firmware with no settings report at all leaves the scale to the
  // operator. One that reports settings is checked against them, and a
  // mismatch or a failed read is never covered by a statement.
  if (snapshot.settingsCapability !== 'none') {
    return { kind: 'unverified', prompt: LASER_MODE_UNVERIFIED_START_PROMPT };
  }
  const statement = standingPowerScaleStatement(project.device);
  if (statement !== null) return { kind: 'operator-stated', statement };
  return {
    kind: 'unverified',
    prompt:
      unreportedPowerScaleFirmware(project.device.controllerKind) === null
        ? LASER_MODE_UNVERIFIED_START_PROMPT
        : unreportedPowerScaleStartPrompt(project.device),
  };
}

export function laserModeStartAcknowledgementRequired(
  project: Project,
  snapshot: LaserModeStartSnapshot,
  _gcode = '',
): boolean {
  // Only the power scale and laser mode are acknowledgeable here; M7 support
  // is surfaced as a Job Review advisory (rule 7 / ADR-228) and never gates
  // Start.
  return laserModeStartReview(project, snapshot)?.kind === 'unverified';
}

export type LaserModeStartConfirmOptions = {
  /** The acknowledgement text; an external run cites its own Run review
   * instead of Job Review (ADR-630 Amendment 4). Default: the review's own. */
  readonly prompt?: string;
  /** False for a program KerfDesk did not build: the operator's statement is
   * about the profile's scale, which a foreign file's S words need not use. */
  readonly operatorStatementApplies?: boolean;
};

export function confirmLaserModeStartEvidence(
  project: Project,
  snapshot: LaserModeStartSnapshot,
  confirm: (message: string) => boolean,
  gcode = '',
  options: LaserModeStartConfirmOptions = {},
): LaserModeStartEvidence | null | undefined {
  const review = laserModeStartReview(project, snapshot);
  if (review === null) return undefined;
  const stated =
    review.kind === 'operator-stated' && options.operatorStatementApplies !== false
      ? review.statement
      : undefined;
  const acknowledgementRequired =
    review.kind === 'unverified' || (review.kind === 'operator-stated' && stated === undefined);
  if (acknowledgementRequired) {
    const prompt =
      options.prompt ??
      (review.kind === 'unverified'
        ? review.prompt
        : unreportedPowerScaleStartPrompt(project.device));
    if (!confirm(prompt)) return null;
  }
  return createLaserModeStartEvidence(
    snapshot,
    project.device.maxPowerS,
    gcodeUsesM7(gcode),
    acknowledgementRequired,
    stated,
  );
}
