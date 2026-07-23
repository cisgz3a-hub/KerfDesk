import {
  countEstimatedFillSegments,
  countOutputVectorSegments,
  estimateJobDuration,
  formatDuration,
  PREPARATION_COMPILED_SEGMENT_BUDGET,
  PREPARATION_RAW_VECTOR_SEGMENT_BUDGET,
  type Job,
  type JobOriginPlacement,
} from '../../core/job';
import { rasterPreparationTooComplex } from '../../core/job/raster-preparation-complexity';
import type { JobDurationBreakdown } from '../../core/job/estimate-duration';
import {
  DEFAULT_OUTPUT_SCOPE,
  validateOutputScope,
  type OutputScope,
  type Project,
} from '../../core/scene';
import {
  prepareOutput,
  prepareOutputSnapshot,
  type PreparedOutput,
  type VariableTextRenderer,
} from '../../io/gcode';
import type { SimilarityTransform } from '../../core/registration';

export { countOutputVectorSegments };
export const LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET = PREPARATION_RAW_VECTOR_SEGMENT_BUDGET;
export const LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET = PREPARATION_COMPILED_SEGMENT_BUDGET;

export type LiveJobEstimate =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'estimated';
      readonly label: string;
      readonly totalSeconds: number;
      readonly breakdown: JobDurationBreakdown;
    }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'preparation-failed'; readonly message: string };

export function estimateLiveJob(
  project: Project,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
  jobOrigin?: JobOriginPlacement,
): LiveJobEstimate {
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return { kind: 'empty' };
  const outputProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };

  // Cheap pre-counts gate compile so huge traces/fills/rasters cannot freeze
  // the ETA. These pause the estimate only — Start/Save/Frame still prepare
  // (ADR-241/ADR-243).
  if (countOutputVectorSegments(outputProject.scene) > LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }
  if (countEstimatedFillSegments(outputProject.scene) > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }
  if (rasterPreparationTooComplex(outputProject)) {
    return { kind: 'too-large' };
  }

  // Same prepared job as Save / Start / Preview, so ETA times the path the
  // machine runs.
  const prepared = prepareOutput(project, {
    outputScope,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
  });
  return estimateLiveJobFromPrepared(prepared, jobOrigin);
}

export async function estimateLiveJobSnapshot(
  project: Project,
  outputScope: OutputScope,
  clock: () => Date,
  renderVariableText: VariableTextRenderer,
  registration?: SimilarityTransform | null,
  jobOrigin?: JobOriginPlacement,
): Promise<LiveJobEstimate> {
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return { kind: 'empty' };
  const outputProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };
  if (countOutputVectorSegments(outputProject.scene) > LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }
  if (countEstimatedFillSegments(outputProject.scene) > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }
  if (rasterPreparationTooComplex(outputProject)) {
    return { kind: 'too-large' };
  }
  const prepared = await prepareOutputSnapshot(project, {
    outputScope,
    clock,
    renderVariableText,
    ...(registration === undefined ? {} : { registration }),
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
  });
  return estimateLiveJobFromPrepared(prepared, jobOrigin);
}

/**
 * estimateLiveJob without the responsiveness gates: prepares and times the
 * job no matter its size. Only call this off the main thread (the ADR-244
 * preparation worker) or in tests.
 */
export function estimateLiveJobUnbounded(
  project: Project,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
  jobOrigin?: JobOriginPlacement,
): LiveJobEstimate {
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return { kind: 'empty' };
  const prepared = prepareOutput(project, {
    outputScope,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
  });
  return estimateLiveJobFromPrepared(prepared, jobOrigin, { unbounded: true });
}

export function estimateLiveJobFromPrepared(
  prepared: PreparedOutput,
  jobOrigin?: JobOriginPlacement,
  options: { readonly unbounded?: boolean } = {},
): LiveJobEstimate {
  if (!prepared.ok) {
    return {
      kind: 'preparation-failed',
      message: prepared.preflight.issues.map((issue) => issue.message).join(' '),
    };
  }
  if (prepared.job.groups.length === 0) return { kind: 'empty' };
  if (
    options.unbounded !== true &&
    countCompiledCutSegments(prepared.job) > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET
  ) {
    return { kind: 'too-large' };
  }

  const currentPosition =
    jobOrigin?.startFrom === 'current-position' ? jobOrigin.currentPosition : undefined;
  const result = estimateJobDuration(
    prepared.job,
    prepared.project.device,
    currentPosition === undefined
      ? {}
      : { initialPosition: currentPosition, finishPosition: currentPosition },
  );
  return result.totalSeconds > 0
    ? {
        kind: 'estimated',
        label: formatDuration(result.totalSeconds),
        totalSeconds: result.totalSeconds,
        breakdown: result.breakdown,
      }
    : { kind: 'empty' };
}

function countCompiledCutSegments(job: Job): number {
  let count = 0;
  for (const group of job.groups) {
    if (group.kind === 'cut' || group.kind === 'fill') count += group.segments.length;
  }
  return count;
}
