import type { JobOriginPlacement } from '../../core/job';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { OutputScope, Project } from '../../core/scene';
import type { PreparedOutput, PrepareOutputOptions } from '../../io/gcode';
import type { JobPlacementSettings } from '../job-placement';
import { runtimeCoordinatePreparationOptions } from '../job-placement';
import { canvasPlanRetentionKey } from '../state/canvas-motion-plan';
import { frameBoundsPreviewOf, type FrameBoundsPreview } from './frame-bounds-preview';
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
  requireFrame: boolean,
  prepare: (project: Project, options: PrepareOutputOptions) => Promise<PreparedOutput>,
  /** Receives the Frame rectangles as soon as the job is compiled, before the
   * costly remainder of preparation (ADR-353). */
  onFrameBounds?: (preview: FrameBoundsPreview) => void,
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
    ...runtimeCoordinatePreparationOptions(
      project.device,
      input.placement,
      input.machineWithReportUnits,
    ),
    ...(input.placement.jobOrigin === undefined ? {} : { jobOrigin: input.placement.jobOrigin }),
    outputScope,
  });
  const inspected = inspectPreparedStart(prepared, machine);
  if (!inspected.ok) return inspected;
  const canvasPlanKey = canvasPlanRetentionKey(project, outputScope, input.effectivePlacement);
  onFrameBounds?.(frameBoundsPreviewOf(inspected.prepared, canvasPlanKey));
  return finalizeStartPreparation({
    project,
    controllerSettings,
    machine,
    machineWithReportUnits: input.machineWithReportUnits,
    outputScope,
    requireFrame,
    placement: input.placement,
    motionOffset: input.motionOffset,
    inspected,
    canvasPlanKey,
    printCutRegistrationActive: false,
    sourceGeometryChecks: 'full',
  });
}
