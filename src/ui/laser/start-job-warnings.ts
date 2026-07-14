import type { OverrideValues } from '../../core/controllers/grbl';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import { machineKindOf, type Project } from '../../core/scene';
import { cncOverrideStartWarning } from '../state/cnc-accessory-readiness';
import { detectMachineJobWarnings } from './machine-job-warnings';

export function collectStartWarnings(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  controllerWarnings: ReadonlyArray<string>,
  overrides: OverrideValues | null | undefined,
): string[] {
  const overrideWarning = cncOverrideStartWarning(machineKindOf(project.machine), overrides);
  return [
    ...controllerWarnings,
    ...detectMachineJobWarnings(project, controllerSettings),
    ...(overrideWarning === null ? [] : [overrideWarning]),
  ];
}
