// external-run-z-top — an external program's lifts against the top of Z
// travel (ADR-491 Amendment 3, rolling audit v5 J7-P2-2). Start checks a
// KerfDesk job's park lift (Amendment 2). Each per-bit file of a setup
// package ends with the same `G0 Z<park>`, and any router program may lift as
// high, so the Run review checks its highest work Z with the same live
// evidence: this session's `$$` and Home (or soft limits), the reported work
// offset, and G54. A G53 move names a machine Z, checked against the top
// directly. A warning informs, never refuses (PROJECT.md rule 21, ADR-228).

import type { ExternalProgramZLifts } from '../../core/external-program';
import { machineKindOf, type Project } from '../../core/scene';
import {
  checkCncLiftAgainstZTop,
  checkMachineZAgainstZTop,
  type CncZTopEvidence,
} from '../laser/cnc-park-z-top';
import { formatMm } from '../laser/job-review/job-review-format';

const STALL =
  'Z runs into its stop: with limits on the controller alarms, with them off Z stalls and ' +
  'loses steps, so the next job on this zero cuts deeper.';

/** Run review warnings for lifts past the Z top; none when they fit or cannot be checked. */
export function externalZTopWarnings(
  lifts: ExternalProgramZLifts,
  evidence: CncZTopEvidence,
  project: Project,
): ReadonlyArray<string> {
  if (machineKindOf(project.machine) !== 'cnc') return [];
  const zTravelMm = project.device.zTravelMm;
  const warnings: string[] = [];
  if (lifts.workMaxMm !== null) {
    const check = checkCncLiftAgainstZTop(lifts.workMaxMm, evidence, zTravelMm);
    if (check.kind === 'over') {
      warnings.push(
        `The program lifts to Z${formatMm(lifts.workMaxMm)}, ${formatMm(check.overMm)} mm past ` +
          `the top of Z travel with the work zero set now. ${STALL} ${workFitAdvice(check.highestFitMm)}`,
      );
    }
  }
  if (lifts.machineMaxMm !== null) {
    const check = checkMachineZAgainstZTop(lifts.machineMaxMm, evidence, zTravelMm);
    if (check.kind === 'over') {
      warnings.push(
        `The program moves to machine Z${formatMm(lifts.machineMaxMm)} (G53), ` +
          `${formatMm(check.overMm)} mm past the top of Z travel. ${STALL} ` +
          `Keep its G53 moves at machine Z${formatMm(check.highestFitMm)} or lower.`,
      );
    }
  }
  return warnings;
}

// A KerfDesk file lifts to its Park height, which is saved into the file, so
// the advice names both.
function workFitAdvice(highestFitMm: number): string {
  if (highestFitMm <= 0) {
    return 'The work zero sits above the top of Z travel: zero Z again on the stock top.';
  }
  const fit = formatMm(Math.floor(highestFitMm * 10) / 10);
  return (
    `Keep the program at Z${fit} or lower (for a KerfDesk file, set Park height to ${fit} mm ` +
    'or lower and save the file again), or zero Z higher.'
  );
}
