import { cncSubProfileIssues } from '../devices/cnc-sub-profile-validation';
import type { CncMachineConfig } from '../scene';
import type { PreflightIssue } from './preflight';

export function cncMachineParamIssues(machine: CncMachineConfig): ReadonlyArray<PreflightIssue> {
  return cncSubProfileIssues(machine.params, 'machine.params').map((message) => ({
    code: 'cnc-machine-params-invalid',
    message: `${message}. Correct it in Machine Setup before preparing output.`,
  }));
}
