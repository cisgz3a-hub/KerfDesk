import type { JobOriginPlacement } from '../../core/job';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { OutputScope, Project } from '../../core/scene';
import type { PreparedOutput, PrepareOutputOptions } from '../../io/gcode';
import type { JobPlacementSettings } from '../job-placement';
import { canvasPlanRetentionKey } from '../state/canvas-motion-plan';
import { prepareStartInput } from './start-job-input';
import {
  finalizeStartPreparation,
  inspectPreparedStart,
  type MachineStartSnapshot,
  type StartJobPreparation,
} from './start-job-readiness';

export async function prepareStartJobAsync(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings,
  outputScope: OutputScope,
  resolvedJobOrigin: JobOriginPlacement | undefined,
  allowRotaryRaster: boolean,
  requireFrame: boolean,
  prepare: (project: Project, options: PrepareOutputOptions) => Promise<PreparedOutput>,
): Promise<StartJobPreparation> {
  const input = prepareStartInput(
    project,
    controllerSettings,
    machine,
    jobPlacement,
    resolvedJobOrigin,
  );
  if (!input.ok) return input.result;
  const prepared = await prepare(project, {
    ...(input.placement.jobOrigin === undefined ? {} : { jobOrigin: input.placement.jobOrigin }),
    outputScope,
  });
  const inspected = inspectPreparedStart(prepared, machine);
  if (!inspected.ok) return inspected;
  return finalizeStartPreparation({
    project,
    controllerSettings,
    machine,
    machineWithReportUnits: input.machineWithReportUnits,
    outputScope,
    allowRotaryRaster,
    requireFrame,
    placement: input.placement,
    motionOffset: input.motionOffset,
    inspected,
    canvasPlanKey: canvasPlanRetentionKey(project, outputScope, input.effectivePlacement),
    printCutRegistrationActive: false,
    sourceGeometryChecks: 'full',
  });
}
