// Pure idle-canvas marker preparation. The React hook dispatches this work to
// a module worker for V-carve scenes; keeping the implementation here lets the
// worker and focused parity tests share exactly one preparation path.

import type { StatusQueryCapability } from '../../core/controllers';
import type { JobOriginPlacement } from '../../core/job';
import type { SimilarityTransform } from '../../core/registration';
import type { OutputScope, Project } from '../../core/scene';
import { prepareOutputSnapshot } from '../../io/gcode';
import { hydratePagedRasterProject } from '../import/paged-raster-hydration';
import type { JobPlacementSettings, ResolvedJobPlacement } from '../job-placement';
import type { MachineStartSnapshot } from '../laser/start-job-readiness';
import { renderVariableText } from '../text/render-variable-text';
import {
  buildCanvasMarkerPlan,
  canvasPlanRetentionKey,
  type CanvasMotionPlan,
} from '../state/canvas-motion-plan';

export type IdleCanvasMotionPlanRequest = {
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly placementSettings: JobPlacementSettings;
  readonly resolvedPlacement: ResolvedJobPlacement;
  readonly registration?: SimilarityTransform | null;
  readonly machine: MachineStartSnapshot;
  readonly statusQuery: StatusQueryCapability;
  readonly reportInches: boolean;
};

export async function buildIdleCanvasMotionPlanFromRequest(
  request: IdleCanvasMotionPlanRequest,
): Promise<CanvasMotionPlan | null> {
  const jobOrigin: JobOriginPlacement | undefined = request.resolvedPlacement.ok
    ? request.resolvedPlacement.jobOrigin
    : undefined;
  const retentionKey = canvasPlanRetentionKey(
    request.project,
    request.outputScope,
    request.placementSettings,
    request.registration,
  );
  const preparationProject = await hydratePagedRasterProject(request.project);
  const prepared = await prepareOutputSnapshot(preparationProject, {
    clock: () => new Date(),
    renderVariableText,
    ...(request.registration === undefined ? {} : { registration: request.registration }),
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
    outputScope: request.outputScope,
  });
  if (!prepared.ok) return null;
  return buildCanvasMarkerPlan({
    prepared,
    machine: request.machine,
    statusQuery: request.statusQuery,
    reportInches: request.reportInches,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
    relativeView: !request.resolvedPlacement.ok,
    retentionKey,
  });
}
