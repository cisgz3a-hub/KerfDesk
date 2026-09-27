// The work origin an interrupted laser job ran with, and what recovery says
// when the controller no longer has it (ADR-341 Amendment 5).
//
// Recovery replays the saved program in the controller's current work
// coordinates. A controller reset or power loss clears an origin made with Set
// origin here, so the ordinary Start refusal ("Click Set origin here first")
// sent the operator to set a new origin wherever the head had stopped, and the
// rest of the job burned shifted by the difference. Recovery names the saved
// origin instead and points to Restore saved origin.

import { USER_ORIGIN_REQUIRED_MESSAGE, VERIFIED_ORIGIN_REQUIRED_MESSAGE } from '../job-placement';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import type { RecoveryArtifactV1 } from '../state/recovery/execution-artifact';

/** Largest origin difference still read as the same origin (GRBL reports three decimals). */
export const RECOVERY_ORIGIN_TOLERANCE_MM = 0.05;

/** The work offset observed when the run was archived, in mm from machine
 * zero; a run too large to archive keeps the one reported at its Start
 * (Amendment 8). */
export function savedWorkOffsetMm(artifact: RecoveryArtifactV1): WorkCoordinateOffset | null {
  if (artifact.kind === 'legacy-fingerprint-only') return artifact.startWorkOffsetMm ?? null;
  const observation = artifact.archivedControllerObservation;
  const wco = observation.wco ?? null;
  if (wco === null) return null;
  const scale = observation.settings?.reportInches === true ? 25.4 : 1;
  return { x: wco.x * scale, y: wco.y * scale, z: wco.z * scale };
}

/** True when two XY origins agree within the recovery tolerance. */
export function sameRecoveryOrigin(
  a: Pick<WorkCoordinateOffset, 'x' | 'y'>,
  b: Pick<WorkCoordinateOffset, 'x' | 'y'>,
): boolean {
  return (
    Math.abs(a.x - b.x) <= RECOVERY_ORIGIN_TOLERANCE_MM &&
    Math.abs(a.y - b.y) <= RECOVERY_ORIGIN_TOLERANCE_MM
  );
}

/** Origins in hundredths of a millimetre, finer than the 0.05 mm tolerance. */
export function formatOriginMm(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

export function recoveryOriginLostMessage(saved: WorkCoordinateOffset | null): string {
  const where =
    saved === null
      ? ''
      : ` It was at X ${formatOriginMm(saved.x)}, Y ${formatOriginMm(saved.y)} mm from machine zero.`;
  return (
    `The controller no longer has the work origin this job ran with.${where} A controller ` +
    'reset or power loss clears an origin made with Set origin here. Setting a new origin ' +
    'where the head is now would shift the rest of the job. Put the saved origin back first: ' +
    "home the machine if it was reset, then use Restore saved origin in the interrupted job's " +
    'Review. If the machine was not homed and the head has not moved since a lost ' +
    'connection, use Continue from where the head stopped there instead.'
  );
}

/** The ordinary Start refusals, with the missing-origin ones said for a recovery. */
export function recoveryRefusalMessages(
  messages: ReadonlyArray<string>,
  saved: WorkCoordinateOffset | null,
): ReadonlyArray<string> {
  return messages.map((message) =>
    message === USER_ORIGIN_REQUIRED_MESSAGE || message === VERIFIED_ORIGIN_REQUIRED_MESSAGE
      ? recoveryOriginLostMessage(saved)
      : message,
  );
}
