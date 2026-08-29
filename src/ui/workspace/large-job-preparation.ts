import type { JobOriginPlacement } from '../../core/job';
import type { OutputScope, Project, Vec2 } from '../../core/scene';
import type { SimilarityTransform } from '../../core/registration';
import { prepareOutput, type PreparedOutput, type PrepareOutputOptions } from '../../io/gcode';
import { estimateLiveJobFromPrepared, type LiveJobEstimate } from '../laser/live-job-estimate';
import { buildPreviewToolpathFromPrepared } from './draw-preview';
import { serializeExecutablePlanPreviewRoute } from './executable-plan-preview-route';
import type { PreviewToolpath } from './preview-status';
import { registerPreviewJobOriginOffset } from './preview-scene-frame';

export type LargeJobPreparation = {
  readonly toolpath: PreviewToolpath;
  readonly estimate: LiveJobEstimate;
  /** Clone-safe carrier restored into the process-local preview association. */
  readonly jobOriginOffset?: Vec2;
};

export type LargeJobPreparationOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
  readonly snapshot?: { readonly registration?: SimilarityTransform | null };
};

/**
 * Compile a large job once, then derive the preview and ETA from that exact
 * prepared output. This is intentionally unbounded and belongs in a worker.
 */
export function prepareLargeJob(
  project: Project,
  options: LargeJobPreparationOptions = {},
  prepare: typeof prepareOutput = prepareOutput,
): LargeJobPreparation {
  const prepared = prepare(project, {
    ...(options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin }),
    ...(options.outputScope === undefined ? {} : { outputScope: options.outputScope }),
  });
  return largeJobPreparationFromPrepared(project, prepared, options);
}

export async function prepareLargeJobAsync(
  project: Project,
  options: LargeJobPreparationOptions,
  prepare: (project: Project, options: PrepareOutputOptions) => Promise<PreparedOutput>,
): Promise<LargeJobPreparation> {
  const prepared = await prepare(project, {
    ...(options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin }),
    ...(options.outputScope === undefined ? {} : { outputScope: options.outputScope }),
  });
  return largeJobPreparationFromPrepared(project, prepared, options);
}

export function largeJobPreparationFromPrepared(
  project: Project,
  prepared: PreparedOutput,
  options: LargeJobPreparationOptions,
): LargeJobPreparation {
  const toolpath = buildPreviewToolpathFromPrepared(project, prepared, options.jobOrigin, {
    executablePlan: true,
  });
  const serializedToolpath = serializeExecutablePlanPreviewRoute(toolpath);
  const jobOriginOffset = prepared.ok ? prepared.jobOriginOffset : { x: 0, y: 0 };
  registerPreviewJobOriginOffset(serializedToolpath, jobOriginOffset);
  return {
    toolpath: serializedToolpath,
    jobOriginOffset,
    estimate: estimateLiveJobFromPrepared(prepared, options.jobOrigin, { unbounded: true }),
  };
}
