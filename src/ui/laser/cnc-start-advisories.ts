// CNC Start advisories that depend on live machine state (not just the project),
// so they cannot live in detectMachineJobWarnings (which is shared with the
// Save-G-code path and has no machine snapshot). These are WARN-not-block, per
// the ADR-111 beginner-safety philosophy.

import { machineKindOf, type Project } from '../../core/scene';

export const CNC_NO_WORK_ZERO_ADVISORY =
  'No work zero is set — the CNC toolpath assumes Z0 is the stock top. Jog to the ' +
  'stock surface and Zero Z (or probe) before running, or the cut depth will be wrong.';

// A CNC job's emitter treats Z0 as the stock top (cnc-grbl-strategy assumes it),
// but Start does not otherwise confirm a work offset was ever established. When
// no origin is active (workOriginActive is not true → workOriginSource 'none'),
// a homed machine would run the first plunge in machine coordinates. Warn, don't
// block: the app cannot prove controller state, so it makes the assumption
// explicit rather than refusing. Laser jobs are unaffected (no stock-top Z
// contract). Clears automatically once the operator Zeroes Z / sets an origin.
export function cncWorkZeroAdvisory(
  project: Project,
  workOriginActive: boolean | undefined,
): string | null {
  if (machineKindOf(project.machine) !== 'cnc') return null;
  if (workOriginActive === true) return null;
  return CNC_NO_WORK_ZERO_ADVISORY;
}
