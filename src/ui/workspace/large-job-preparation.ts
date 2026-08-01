import type { JobOriginPlacement } from '../../core/job';
import type { OutputScope, Project } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { estimateLiveJobFromPrepared, type LiveJobEstimate } from '../laser/live-job-estimate';
import { buildPreviewToolpathFromPrepared } from './draw-preview';
import type { PreviewToolpath } from './preview-status';

export type LargeJobPreparation = {
  readonly toolpath: PreviewToolpath;
  readonly estimate: LiveJobEstimate;
};

export type LargeJobPreparationOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
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
  return {
    toolpath: buildPreviewToolpathFromPrepared(project, prepared, options.jobOrigin),
    estimate: estimateLiveJobFromPrepared(prepared, options.jobOrigin, { unbounded: true }),
  };
}
