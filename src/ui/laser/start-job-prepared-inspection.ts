import type { CncToolPlanEntry } from '../state/cnc-tool-plan';
import { cncToolPlan } from '../state/cnc-tool-plan';
import type { PreparedOutput } from '../../io/gcode';
import type { MachineStartSnapshot } from './start-job-readiness';
import { cncWorkZeroToolStartIssue } from './cnc-start-advisories';

export type PreparedStartInspection =
  | {
      readonly ok: true;
      readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
      readonly toolPlan: ReadonlyArray<CncToolPlanEntry>;
      // Placement and tool/Work-Z policy findings inform Job Review.
      readonly advisoryWarnings: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

/** Inspect already-compiled output without adding an ordinary Start policy gate. */
export function inspectPreparedStart(
  prepared: PreparedOutput,
  machine: MachineStartSnapshot,
): PreparedStartInspection {
  if (!prepared.ok) {
    return { ok: false, messages: prepared.preflight.issues.map((issue) => issue.message) };
  }
  const advisoryWarnings: string[] = [];
  const toolPlan = cncToolPlan(prepared.job);
  const toolIssue = cncWorkZeroToolStartIssue(
    prepared.project,
    machine.workZZeroEvidence,
    toolPlan[0],
  );
  if (toolIssue !== null) advisoryWarnings.push(toolIssue);
  return { ok: true, prepared, toolPlan, advisoryWarnings };
}
