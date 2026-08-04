import type { OverrideValues } from '../../core/controllers/grbl';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import { machineKindOf, type Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { cncOverrideStartWarning } from '../state/cnc-accessory-readiness';
import { detectMachineJobWarnings } from './machine-job-warnings';

export function collectStartWarnings(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  controllerWarnings: ReadonlyArray<string>,
  overrides: OverrideValues | null | undefined,
  activeWcs: ActiveWorkCoordinateSystem | null = null,
  prepared?: Extract<PreparedOutput, { readonly ok: true }>,
  sourceGeometryChecks: 'full' | 'compiled-evidence-only' = 'full',
): string[] {
  const machineKind = machineKindOf(project.machine);
  const overrideWarning = cncOverrideStartWarning(machineKind, overrides);
  return [
    ...controllerWarnings,
    ...detectMachineJobWarnings(
      project,
      controllerSettings,
      activeWcs,
      prepared,
      sourceGeometryChecks,
    ),
    ...(overrideWarning === null ? [] : [overrideWarning]),
  ];
}
