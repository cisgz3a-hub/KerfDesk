// CNC Start advisories that depend on live machine state (not just the project),
// so they cannot live in detectMachineJobWarnings (which is shared with the
// Save-G-code path and has no machine snapshot). These are WARN-not-block, per
// the ADR-111 beginner-safety philosophy.

import { machineKindOf, type Project } from '../../core/scene';
import { isWorkZZeroEvidenceCurrent, type WorkZZeroEvidence } from '../state/work-z-zero-evidence';

export const CNC_NO_WORK_ZERO_ADVISORY =
  'No work zero is set — the CNC toolpath assumes Z0 is the stock top. Jog to the ' +
  'stock surface and Zero Z (or probe) before running, or the cut depth will be wrong.';

// A CNC job's emitter treats Z0 as the stock top (cnc-grbl-strategy assumes it),
// but Start does not otherwise confirm work Z0 was ever established. This keys on
// workZZeroEvidence, NOT workOriginActive: Set Origin (G92 X0 Y0) establishes the XY
// origin without touching Z, so it must not suppress the Z-depth warning; only
// Zero Z (G92 Z0) or a successful probe do (Codex audit P1). Warn, don't block:
// the app cannot prove controller state, so it makes the assumption explicit
// rather than refusing. Laser jobs are unaffected (no stock-top Z contract).
export function cncWorkZeroAdvisory(
  project: Project,
  evidence: WorkZZeroEvidence | null | undefined,
  referenceEpoch: number | undefined,
): string | null {
  if (machineKindOf(project.machine) !== 'cnc') return null;
  if (isWorkZZeroEvidenceCurrent(evidence, referenceEpoch)) return null;
  return CNC_NO_WORK_ZERO_ADVISORY;
}
