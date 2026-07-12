import {
  countEstimatedFillSegments,
  countOutputVectorSegments,
  estimateJobDuration,
  formatDuration,
  PREPARATION_COMPILED_SEGMENT_BUDGET,
  PREPARATION_RAW_VECTOR_SEGMENT_BUDGET,
  type Job,
} from '../../core/job';
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

export { countOutputVectorSegments };
export const LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET = PREPARATION_RAW_VECTOR_SEGMENT_BUDGET;
export const LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET = PREPARATION_COMPILED_SEGMENT_BUDGET;

export type LiveJobEstimate =
  | { readonly kind: 'empty' }
  | { readonly kind: 'estimated'; readonly label: string }
  | { readonly kind: 'too-large' };

export function estimateLiveJob(
  project: Project,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
): LiveJobEstimate {
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return { kind: 'empty' };
  const outputProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };

  // Cheap vector pre-counts gate compile so huge traces/fills cannot freeze ETA.
  if (countOutputVectorSegments(outputProject.scene) > LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }
  if (countEstimatedFillSegments(outputProject.scene) > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }

  // Same prepared job as Save / Start / Preview, so ETA times the path the
  // machine runs. Over-budget raster preparation reports too-large instead.
  const prepared = prepareOutput(project, { outputScope });
  return estimatePrepared(prepared);
}

export async function estimateLiveJobSnapshot(
  project: Project,
  outputScope: OutputScope,
  clock: () => Date,
  renderVariableText: VariableTextRenderer,
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
  const prepared = await prepareOutputSnapshot(project, {
    outputScope,
    clock,
    renderVariableText,
  });
  return estimatePrepared(prepared);
}

function estimatePrepared(prepared: PreparedOutput): LiveJobEstimate {
  if (!prepared.ok) return { kind: 'too-large' };
  if (prepared.job.groups.length === 0) return { kind: 'empty' };
  if (countCompiledCutSegments(prepared.job) > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }

  const result = estimateJobDuration(prepared.job, prepared.project.device);
  return result.totalSeconds > 0
    ? { kind: 'estimated', label: formatDuration(result.totalSeconds) }
    : { kind: 'empty' };
}

function countCompiledCutSegments(job: Job): number {
  let count = 0;
  for (const group of job.groups) {
    if (group.kind === 'cut' || group.kind === 'fill') count += group.segments.length;
  }
  return count;
}
