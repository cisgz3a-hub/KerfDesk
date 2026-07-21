// Frame-first policy helpers kept separate from the Start preparation pipeline.
// They classify former policy blockers as Job Review warnings while preserving
// the small set of emit failures that cannot produce an executable program.

import type { OverrideValues, StatusReport } from '../../core/controllers/grbl';
import { scenePreparationTooComplex } from '../../core/job';
import type { PreflightIssue } from '../../core/preflight';
import { machineKindOf, type Project, type Scene } from '../../core/scene';
import { cncAccessoryStartIssue, cncOverrideStartIssue } from '../state/cnc-accessory-readiness';
import { cncWorkZeroStartIssue } from './cnc-start-advisories';
import type { MachineStartSnapshot } from './start-job-readiness';

export const CNC_REQUIRES_GRBL_MESSAGE =
  'CNC jobs require a GRBL-family controller (GRBL, grblHAL, FluidNC). The connected firmware does not accept the GRBL CNC dialect — e.g. it reads the G4 spin-up dwell in milliseconds instead of seconds, so the bit would plunge before the spindle is at speed.';

export function demotedPolicyWarnings(project: Project, machine: MachineStartSnapshot): string[] {
  const warnings: string[] = [];
  const machineKind = machineKindOf(project.machine);
  if (machineKind === 'cnc' && machine.cncJobsSupported === false) {
    warnings.push(CNC_REQUIRES_GRBL_MESSAGE);
  }
  warnings.push(...cncOverrideStartIssues(project, machine.ovCache));
  warnings.push(...cncAccessoryStartIssues(project, machine.accessoryCache));
  const workZeroIssue = cncWorkZeroStartIssue(
    project,
    machine.workZZeroEvidence,
    machine.workZReferenceEpoch,
    machine.controllerSessionEpoch,
  );
  if (workZeroIssue !== null) warnings.push(workZeroIssue);
  return warnings;
}

export const LARGE_JOB_PREPARATION_WARNING =
  'Large job: this design is over the live preview and estimate budget, so those stay paused. Preparing and streaming the program may take longer than usual.';

// The former pre-emit curve/fill segment budget refusal, demoted to a Job
// Review advisory (rule 7 / ADR-241): the operator is informed, never blocked.
export function largeJobPreparationWarning(scene: Scene): string | null {
  return scenePreparationTooComplex(scene) ? LARGE_JOB_PREPARATION_WARNING : null;
}

const EMIT_BLOCKING_PREFLIGHT_CODES: ReadonlySet<string> = new Set([
  'non-finite-coordinate',
  'empty-output',
  'relief-needs-cnc',
  'no-output-layer',
]);

export function partitionEmitPreflight(preflight: {
  readonly issues: ReadonlyArray<PreflightIssue>;
}): {
  readonly blocking: string[];
  readonly warnings: string[];
} {
  const blocking: string[] = [];
  const warnings: string[] = [];
  for (const issue of preflight.issues) {
    (EMIT_BLOCKING_PREFLIGHT_CODES.has(issue.code) ? blocking : warnings).push(issue.message);
  }
  return { blocking, warnings };
}

function cncAccessoryStartIssues(
  project: Project,
  accessories: NonNullable<StatusReport['accessories']> | null | undefined,
): ReadonlyArray<string> {
  const issue = cncAccessoryStartIssue(machineKindOf(project.machine), accessories);
  return issue === null ? [] : [issue];
}

function cncOverrideStartIssues(
  project: Project,
  overrides: OverrideValues | null | undefined,
): ReadonlyArray<string> {
  const issue = cncOverrideStartIssue(machineKindOf(project.machine), overrides);
  return issue === null ? [] : [issue];
}
