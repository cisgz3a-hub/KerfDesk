import {
  countEstimatedFillSegments,
  countOutputVectorSegments,
  estimateJobDuration,
  formatDuration,
  PREPARATION_COMPILED_SEGMENT_BUDGET,
  PREPARATION_RAW_VECTOR_SEGMENT_BUDGET,
  type Job,
} from '../../core/job';
import type { Project } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';

export { countOutputVectorSegments };
export const LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET = PREPARATION_RAW_VECTOR_SEGMENT_BUDGET;
export const LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET = PREPARATION_COMPILED_SEGMENT_BUDGET;

export type LiveJobEstimate =
  | { readonly kind: 'empty' }
  | { readonly kind: 'estimated'; readonly label: string }
  | { readonly kind: 'too-large' };

export function estimateLiveJob(project: Project): LiveJobEstimate {
  // Cheap vector pre-counts gate the compile so a huge trace never reaches it.
  if (countOutputVectorSegments(project.scene) > LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }
  if (countEstimatedFillSegments(project.scene) > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }

  // Same prepared job (budget guard + compile + optimize) as Save / Start /
  // Preview, so the ETA times the exact path the machine runs (roadmap P1-C). A
  // raster over the pixel budget prepares to nothing -> too-large (roadmap P1-A).
  const prepared = prepareOutput(project);
  if (!prepared.ok) return { kind: 'too-large' };
  if (prepared.job.groups.length === 0) return { kind: 'empty' };
  if (countCompiledCutSegments(prepared.job) > LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET) {
    return { kind: 'too-large' };
  }

  const result = estimateJobDuration(prepared.job, project.device);
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
