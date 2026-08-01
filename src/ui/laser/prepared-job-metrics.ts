import {
  computeJobBounds,
  computeJobMotionBounds,
  estimateJobDuration,
  machineSpaceJob,
  type JobBounds,
  type JobDurationEstimate,
  type JobOriginPlacement,
} from '../../core/job';
import { resolveJobParkTarget } from '../../core/output';
import { machineKindOf, type Vec2 } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';

type SuccessfulPreparedOutput = Extract<PreparedOutput, { readonly ok: true }>;

export type PreparedJobMetrics = {
  readonly duration: JobDurationEstimate;
  readonly jobBounds: JobBounds | null;
  readonly motionBounds: JobBounds | null;
  readonly frameJobBounds: JobBounds | null;
  readonly frameMotionBounds: JobBounds | null;
  readonly parkTarget: Vec2 | null;
};

/** Precompute every raster-scanning fact consumed after preparation. Worker
 * callers can then persist a provider recipe without recompiling on the UI
 * thread, while Frame/Review still describe the exact emitted job. */
export function buildPreparedJobMetrics(
  prepared: SuccessfulPreparedOutput,
  jobOrigin?: JobOriginPlacement,
): PreparedJobMetrics {
  const device = prepared.project.device;
  const machineKind = machineKindOf(prepared.project.machine);
  const finishPosition =
    jobOrigin?.startFrom === 'current-position' ? jobOrigin.currentPosition : undefined;
  const framedJob = machineSpaceJob(prepared.job, device, prepared.project.machine);
  // ADR-127: the rotary mapping must be applied everywhere the job is
  // MEASURED, and the head travels machine millimetres, not design-surface
  // millimetres. Estimating the surface job under-counted every Y component by
  // the rotary scale (~1.91x on the shipped chuck defaults, i.e. the Time tile
  // showed roughly half the real duration). machineSpaceJob is the identity
  // when no rotary is active, so flat jobs are unchanged.
  const duration = estimateJobDuration(
    framedJob,
    device,
    finishPosition === undefined ? {} : { initialPosition: finishPosition, finishPosition },
  );
  const jobBounds = computeJobBounds(prepared.job, device);
  const motionBounds = computeJobMotionBounds(prepared.job, device);
  const frameJobBounds = computeJobBounds(framedJob, device);
  const frameMotionBounds = computeJobMotionBounds(framedJob, device);
  return {
    duration,
    jobBounds,
    motionBounds,
    frameJobBounds,
    frameMotionBounds,
    parkTarget: resolveJobParkTarget(prepared.job, device, machineKind, finishPosition),
  };
}
