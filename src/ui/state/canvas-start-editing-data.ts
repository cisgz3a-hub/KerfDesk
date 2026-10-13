import { computeJobBounds, type Job, type JobBounds } from '../../core/job';
import {
  jobStartEditingJob,
  jobStartPointOptions,
  resolveJobStartPoint,
} from '../../core/job/job-start-point';
import type { Vec2 } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';

/** Cloneable marker-editing geometry. Never sends raster pixels/providers or
 * later operations back from the idle-preparation worker. */
export type CanvasStartEditingData = {
  readonly job: Job;
  readonly jobOriginOffset: Vec2;
  readonly bounds: JobBounds | null;
  readonly jobReason: string | null;
};

export function buildCanvasStartEditingData(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
): CanvasStartEditingData {
  const options = jobStartPointOptions(
    prepared.project.optimization,
    prepared.project.device.scanningOffsets,
  );
  const selection = resolveJobStartPoint(prepared.job, { x: 0, y: 0 }, options);
  return {
    job: jobStartEditingJob(prepared.job, options),
    jobOriginOffset: prepared.jobOriginOffset,
    bounds: computeJobBounds(prepared.job, prepared.project.device),
    jobReason:
      selection?.supported === true
        ? null
        : (selection?.reason ?? 'This operation has no movable cutting start.'),
  };
}
