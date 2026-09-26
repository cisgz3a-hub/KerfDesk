import {
  countOutputVectorSegments,
  estimateJobDuration,
  formatDuration,
  machineSpaceJob,
  PREPARATION_COMPILED_SEGMENT_BUDGET,
  PREPARATION_RAW_VECTOR_SEGMENT_BUDGET,
  type Job,
  type JobOriginPlacement,
} from '../../core/job';
import type {
  JobDurationBreakdown,
  JobDurationEstimate,
  JobDurationEstimateOptions,
} from '../../core/job/estimate-duration';
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
  type PrepareOutputOptions,
  type VariableTextRenderer,
} from '../../io/gcode';
import type { SimilarityTransform } from '../../core/registration';
import { hydratePagedRasterProject } from '../import/paged-raster-hydration';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';

export { countOutputVectorSegments };
export const LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET = PREPARATION_RAW_VECTOR_SEGMENT_BUDGET;
export const LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET = PREPARATION_COMPILED_SEGMENT_BUDGET;
export type LiveJobEstimateOptions = Pick<JobDurationEstimateOptions, 'initialPosition'> &
  Pick<
    PrepareOutputOptions,
    'contourEntryBounds' | 'absoluteProgramOffset' | 'workZeroBedPosition'
  >;

export type LiveJobEstimate =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'estimated';
      readonly label: string;
      readonly totalSeconds: number;
      readonly breakdown: JobDurationBreakdown;
      readonly manualPauseCount?: number;
    }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'preparation-failed'; readonly message: string };

export function estimateLiveJob(
  project: Project,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
  jobOrigin?: JobOriginPlacement,
  options: LiveJobEstimateOptions = {},
): LiveJobEstimate {
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return { kind: 'empty' };
  const outputProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };

  // Cheap pre-counts gate compile so huge traces/fills/rasters cannot freeze
  // the ETA. These pause the estimate only — Start/Save/Frame still prepare
  // (ADR-241/ADR-243).
  //
  // V-carve first, because it is the only check here that does not read a
  // size: the counters measure the INPUT, and a V-carve layer's cost lives in
  // the dense variable-depth route it amplifies that input into (~1.5 s for
  // 0.5% of the budget). Without it the ETA compiled V-carve on the main
  // thread the moment the cut type was selected.
  if (costlyCanvasPreparation(outputProject)) return { kind: 'too-large' };

  // Same prepared job as Save / Start / Preview, so ETA times the path the
  // machine runs.
  const prepared = prepareOutput(project, {
    ...options,
    outputScope,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
  });
  return estimateLiveJobFromPrepared(prepared, jobOrigin, options);
}

export async function estimateLiveJobSnapshot(
  project: Project,
  outputScope: OutputScope,
  clock: () => Date,
  renderVariableText: VariableTextRenderer,
  registration?: SimilarityTransform | null,
  jobOrigin?: JobOriginPlacement,
  options: LiveJobEstimateOptions = {},
): Promise<LiveJobEstimate> {
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return { kind: 'empty' };
  const outputProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };
  // Same V-carve term as the synchronous estimate above: prepareOutputSnapshot
  // still runs its compile on this thread, so the amplifying cut type has to
  // pause the estimate here too.
  if (costlyCanvasPreparation(outputProject)) return { kind: 'too-large' };
  const hydrated = await hydratePagedRasterProject(project);
  const prepared = await prepareOutputSnapshot(hydrated, {
    ...options,
    outputScope,
    clock,
    renderVariableText,
    ...(registration === undefined ? {} : { registration }),
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
  });
  return estimateLiveJobFromPrepared(prepared, jobOrigin, options);
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
  options: LiveJobEstimateOptions = {},
): LiveJobEstimate {
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return { kind: 'empty' };
  const prepared = prepareOutput(project, {
    ...options,
    outputScope,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
  });
  return estimateLiveJobFromPrepared(prepared, jobOrigin, { ...options, unbounded: true });
}

export function estimateLiveJobFromPrepared(
  prepared: PreparedOutput,
  jobOrigin?: JobOriginPlacement,
  options: LiveJobEstimateOptions & { readonly unbounded?: boolean } = {},
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

  const finishPosition =
    jobOrigin?.startFrom === 'current-position' ? jobOrigin.currentPosition : undefined;
  // Placement controls the job's coordinates and return target, while the
  // physical head may begin elsewhere in any placement mode.
  const initialPosition = options.initialPosition ?? finishPosition;
  // ADR-127: measure the machine-space job. Identity when no rotary is active,
  // so flat jobs are unchanged. Kept in step with buildPreparedJobMetrics so
  // the live tile and Job Review cannot report different durations.
  const result = estimateJobDuration(
    machineSpaceJob(prepared.job, prepared.project.device, prepared.project.machine),
    prepared.project.device,
    {
      ...(initialPosition === undefined ? {} : { initialPosition }),
      ...(finishPosition === undefined ? {} : { finishPosition }),
    },
  );
  return liveEstimateFromDuration(result);
}

function liveEstimateFromDuration(result: JobDurationEstimate): LiveJobEstimate {
  if (result.unavailableReason !== undefined) {
    return { kind: 'preparation-failed', message: result.unavailableReason };
  }
  return result.totalSeconds > 0
    ? {
        kind: 'estimated',
        label: formatDuration(result.totalSeconds),
        totalSeconds: result.totalSeconds,
        breakdown: result.breakdown,
        ...(result.manualPauseCount === undefined
          ? {}
          : { manualPauseCount: result.manualPauseCount }),
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
