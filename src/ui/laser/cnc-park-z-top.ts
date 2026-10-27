// CNC park lift against the machine's Z top (ADR-491 Amendment 2; meta audit
// M7-P1-2, second CNC audit P2-control-1). The park height is a work Z above
// the stock top, so where it lands in the machine depends on where Z was
// zeroed: with Z zeroed 40 mm below the homed top, a 50 mm park that fits a
// 75 mm travel still lifts 10 mm past the top, at every bit change and at the
// job end. GRBL alarms when soft or hard limits are on; with both off Z stalls
// on its stop and loses steps, and a job-end stall carries into the next job
// on the same zero. Once this session's `$$` and Home (or enforced soft
// limits) fix the Z top and the controller reports its work offset, KerfDesk
// checks the lift and warns; otherwise it says the check could not run.
// Advisory only, never a Start block (PROJECT.md rule 21, ADR-228).

import type { StatusReport } from '../../core/controllers/grbl';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { CncMachineParams, Project } from '../../core/scene';
import { resolveFirmwareZLimits } from '../state/manual-motion-limits';
import type { NativeBedEvidence } from '../state/native-bed-frame';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { formatMm } from './job-review/job-review-format';

const MM_PER_INCH = 25.4;
// Report rounding (3 decimals) on the offset and on the envelope edge.
const TOLERANCE_MM = 0.002;

export type CncZTopEvidence = NativeBedEvidence & {
  readonly statusReport?: StatusReport | null;
  readonly wcoCache?: WorkCoordinateOffset | null;
  readonly reportUnitsUnconfirmed?: boolean;
  readonly activeWcs?: ActiveWorkCoordinateSystem | null;
};

export type CncLiftZTopCheck =
  | { readonly kind: 'fits'; readonly roomMm: number }
  /** highestFitMm: the highest work Z, above the stock top, that stays under the top. */
  | { readonly kind: 'over'; readonly overMm: number; readonly highestFitMm: number }
  | { readonly kind: 'unchecked'; readonly reason: string };

/** Check a lift (a work Z above the stock top) against the live machine Z top. */
export function checkCncLiftAgainstZTop(
  liftMm: number,
  evidence: CncZTopEvidence,
  profileZTravelMm?: number,
): CncLiftZTopCheck {
  const limits = resolveFirmwareZLimits(evidence, profileZTravelMm);
  if (limits === null) {
    return unchecked("the Z top needs this session's $$ and Home (or soft limits on)");
  }
  // The program runs in G54; another system's offset says nothing about it.
  if (evidence.activeWcs != null && evidence.activeWcs !== 'G54') {
    return unchecked(`the live work offset is ${evidence.activeWcs}'s, not G54's`);
  }
  const wco = evidence.statusReport?.wco ?? evidence.wcoCache ?? null;
  if (wco === null || evidence.reportUnitsUnconfirmed === true) {
    return unchecked('the controller has not reported its work offset');
  }
  const scale = evidence.controllerSettings?.reportInches === true ? MM_PER_INCH : 1;
  const topWorkZMm = limits.maxMm - wco.z * scale;
  const overMm = liftMm - topWorkZMm;
  return overMm > TOLERANCE_MM
    ? { kind: 'over', overMm, highestFitMm: topWorkZMm }
    : { kind: 'fits', roomMm: Math.max(0, -overMm) };
}

/** The highest Z a CNC job lifts to, as the compiler stamps it on every group
 * and the emitter lifts: the park height, never below safe Z. */
export function cncHighestLiftMm(params: Pick<CncMachineParams, 'safeZMm' | 'parkZMm'>): number {
  const safeZMm = Math.max(0, params.safeZMm);
  return Math.max(safeZMm, params.parkZMm ?? safeZMm);
}

/** A Start warning when a CNC job's lift runs past the Z top. */
export function detectCncParkZTopWarnings(
  project: Project,
  evidence: CncZTopEvidence,
): ReadonlyArray<string> {
  if (project.machine?.kind !== 'cnc') return [];
  const liftMm = cncHighestLiftMm(project.machine.params);
  const check = checkCncLiftAgainstZTop(liftMm, evidence, project.device.zTravelMm);
  if (check.kind !== 'over') return [];
  return [
    `At the bit changes and the job end this job lifts to Z${formatMm(liftMm)} above the stock ` +
      `top, ${formatMm(check.overMm)} mm past the top of Z travel with the work zero set now. ` +
      'Z runs into its stop: with limits on the controller alarms, with them off Z stalls and ' +
      'loses steps, so the next job on this zero cuts deeper. ' +
      highestFitAdvice(check.highestFitMm),
  ];
}

export function highestFitAdvice(highestFitMm: number): string {
  return highestFitMm > 0
    ? `Set Park height to ${formatMm(Math.floor(highestFitMm * 10) / 10)} mm or lower, or zero Z higher.`
    : 'The work zero sits above the top of Z travel: zero Z again on the stock top.';
}

function unchecked(reason: string): CncLiftZTopCheck {
  return { kind: 'unchecked', reason };
}
