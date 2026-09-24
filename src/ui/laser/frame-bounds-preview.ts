import { frameBoundsSignature, machineSpaceJob, type JobBounds } from '../../core/job';
import { computeFrameJobBounds, computeFrameJobMotionBounds } from '../../core/job/job-bounds';
import type { PreparedOutput } from '../../io/gcode';
import type { PreparedJobMetrics } from './prepared-job-metrics';

/**
 * The rectangles a Frame traces, known as soon as the job is compiled and
 * placed — before the program is emitted, preflighted, timed and packed, which
 * is most of a dense job's preparation (ADR-345). Computed by the same
 * functions on the same compiled job as `PreparedJobMetrics`, so the finished
 * preparation reproduces it exactly; `frameBoundsPreviewMatches` proves that
 * before a traced outline may authorize the exact program (ADR-353).
 */
export type FrameBoundsPreview = {
  readonly frameJobBounds: JobBounds | null;
  readonly frameMotionBounds: JobBounds | null;
  /** The retention key the finished preparation's canvas plan will carry: the
   * execution signature of the job being prepared. */
  readonly retentionKey: string;
};

/** A preview the Frame can physically trace: a finite burn rectangle and a
 * finite motion envelope (the burn rectangle when the job adds no overscan). */
export type TraceableFrameBoundsPreview = FrameBoundsPreview & {
  readonly frameJobBounds: JobBounds;
  readonly frameMotionBounds: JobBounds;
};

export function frameBoundsPreviewOf(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
  retentionKey: string,
): FrameBoundsPreview {
  const device = prepared.project.device;
  const framedJob = machineSpaceJob(prepared.job, device, prepared.project.machine);
  return {
    frameJobBounds: computeFrameJobBounds(framedJob, device),
    frameMotionBounds: computeFrameJobMotionBounds(framedJob, device),
    retentionKey,
  };
}

/** Null when the preview cannot be traced (nothing to frame, or a non-finite
 * rectangle); the exact preparation then reports the real refusal. */
export function traceableFrameBoundsPreview(
  preview: FrameBoundsPreview | null,
): TraceableFrameBoundsPreview | null {
  if (preview === null || preview.frameJobBounds === null) return null;
  const frameMotionBounds = preview.frameMotionBounds ?? preview.frameJobBounds;
  if (!finiteBounds(preview.frameJobBounds) || !finiteBounds(frameMotionBounds)) return null;
  return { ...preview, frameJobBounds: preview.frameJobBounds, frameMotionBounds };
}

/** True when the finished preparation is the program this preview stood for:
 * the same execution signature and the same traced rectangles to the emit
 * precision the Frame verified. */
export function frameBoundsPreviewMatches(
  preview: FrameBoundsPreview,
  prepared: {
    readonly canvasPlan: { readonly retentionKey: string };
    readonly metrics: Pick<PreparedJobMetrics, 'frameJobBounds' | 'frameMotionBounds'>;
  },
): boolean {
  return (
    preview.retentionKey === prepared.canvasPlan.retentionKey &&
    sameBounds(preview.frameJobBounds, prepared.metrics.frameJobBounds) &&
    sameBounds(preview.frameMotionBounds, prepared.metrics.frameMotionBounds)
  );
}

function sameBounds(left: JobBounds | null, right: JobBounds | null): boolean {
  if (left === null || right === null) return left === right;
  return frameBoundsSignature(left) === frameBoundsSignature(right);
}

function finiteBounds(bounds: JobBounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY)
  );
}
