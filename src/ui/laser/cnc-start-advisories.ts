// CNC Start setup gates that depend on live machine state (not just the
// project), so they cannot live in detectMachineJobWarnings (which is shared
// with the Save-G-code path and has no machine snapshot).

import { machineKindOf, type Project } from '../../core/scene';
import type { CncToolPlanEntry } from '../state/cnc-tool-plan';
import {
  isWorkZZeroEvidenceCurrent,
  probePlateRemovalRequired,
  PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE,
  type WorkZZeroEvidence,
} from '../state/work-z-zero-evidence';

export const CNC_NO_WORK_ZERO_START_MESSAGE =
  'No work zero is set — the CNC toolpath assumes Z0 is the stock top. Touch the bit to the ' +
  'stock top and press Zero Z, or run a touch-plate probe, before starting. Zeroing with the ' +
  'bit parked above the stock makes the job cut in the air by that height.';
export const CNC_UNKNOWN_INITIAL_TOOL_START_MESSAGE =
  'The compiled CNC job does not identify its first bit, so KerfDesk cannot prove that work Z ' +
  'belongs to the cutter that will move. Recompile the job with a valid tool assignment.';

// A CNC job's emitter treats Z0 as the stock top (cnc-grbl-strategy assumes it),
// but Start does not otherwise confirm work Z0 was ever established. This keys on
// workZZeroEvidence, NOT workOriginActive: Set Origin (G92 X0 Y0) establishes the XY
// origin without touching Z, so it cannot satisfy the depth gate; only Zero Z
// (G92 Z0) or a successful settled probe do. Laser jobs are unaffected because
// they have no stock-top Z contract.
export function cncWorkZeroStartIssue(
  project: Project,
  evidence: WorkZZeroEvidence | null | undefined,
  referenceEpoch: number | undefined,
): string | null {
  if (machineKindOf(project.machine) !== 'cnc') return null;
  if (!isWorkZZeroEvidenceCurrent(evidence, referenceEpoch)) {
    return CNC_NO_WORK_ZERO_START_MESSAGE;
  }
  return probePlateRemovalRequired(evidence) ? PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE : null;
}

export function cncWorkZeroToolStartIssue(
  project: Project,
  evidence: WorkZZeroEvidence | null | undefined,
  firstTool: CncToolPlanEntry | undefined,
): string | null {
  const machine = project.machine;
  if (machine?.kind !== 'cnc' || firstTool === undefined) return null;
  if (firstTool.id === null) return CNC_UNKNOWN_INITIAL_TOOL_START_MESSAGE;
  if (evidence?.toolId === firstTool.id) return null;

  const expectedName = firstTool.name ?? firstTool.id;
  const evidenceName =
    evidence?.toolId === undefined
      ? 'an unrecorded bit'
      : (machine.tools.find((tool) => tool.id === evidence.toolId)?.name ?? evidence.toolId);
  return (
    `This job starts with ${expectedName}, but work Z was established for ${evidenceName}. ` +
    `Load ${expectedName}, select it as the Active bit, then touch it to the stock top and ` +
    'Zero Z — or probe again.'
  );
}
