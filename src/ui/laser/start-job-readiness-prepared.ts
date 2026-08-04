import type { JobOriginPlacement } from '../../core/job';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import { DEFAULT_OUTPUT_SCOPE, type OutputScope, type Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { DEFAULT_JOB_PLACEMENT, type JobPlacementSettings } from '../job-placement';
import { canvasPlanRetentionKey } from '../state/canvas-motion-plan';
import { prepareStartInput } from './start-job-input';
import {
  finalizeStartPreparation,
  inspectPreparedStart,
  type MachineStartSnapshot,
  type StartJobPreparation,
} from './start-job-readiness';

/** Qualifies an exact prepared output without recompiling its source project. */
export function prepareStartJobFromPrepared(
  project: Project,
  prepared: PreparedOutput,
  controllerSettings: ControllerSettingsSnapshot | null,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
  resolvedJobOrigin?: JobOriginPlacement,
  allowRotaryRaster?: boolean,
  requireFrame = true,
): StartJobPreparation {
  const input = prepareStartInput(
    project,
    controllerSettings,
    machine,
    jobPlacement,
    resolvedJobOrigin,
  );
  if (!input.ok) return input.result;
  const inspected = inspectPreparedStart(prepared, machine);
  if (!inspected.ok) return inspected;
  return finalizeStartPreparation({
    project,
    controllerSettings,
    machine,
    machineWithReportUnits: input.machineWithReportUnits,
    outputScope,
    allowRotaryRaster: allowRotaryRaster === true,
    requireFrame,
    placement: input.placement,
    motionOffset: input.motionOffset,
    inspected,
    canvasPlanKey: canvasPlanRetentionKey(project, outputScope, input.effectivePlacement),
    printCutRegistrationActive: false,
    sourceGeometryChecks: 'compiled-evidence-only',
  });
}
