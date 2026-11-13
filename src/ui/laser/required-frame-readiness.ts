import { frameBoundsSignature, machineSpaceJob } from '../../core/job';
import {
  computeFrameJobBounds,
  computeFrameJobMotionBounds,
  type JobBounds,
} from '../../core/job/job-bounds';
import type { PreparedOutput } from '../../io/gcode';
import { isVerifiedFrameValid, type FrameVerification } from '../state/frame-verification';
import { framesZRotary, withoutRotaryZOffset } from '../state/framed-run-rotary';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
import type { PreparedJobMetrics } from './prepared-job-metrics';

export type RequiredFrameSnapshot = {
  readonly frameVerification?: FrameVerification | null;
  readonly wcoCache?: WorkCoordinateOffset | null;
  readonly workOriginActive?: boolean;
};

/** Frame-first gate: every Start (laser and CNC, every placement mode) needs
 * a Frame recorded for this exact compiled job and origin identity. Any drift
 * — resized artwork, moved origin, different head position baked into a
 * current-position compile — changes the bounds signature or WCO and forces a
 * fresh trace. This is the ONLY Start guard; all other findings surface as
 * Job Review warnings (maintainer, 2026-07-17). */
export function requiredFrameIssueFromPrepared(args: {
  readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
  readonly machine: RequiredFrameSnapshot;
  /** The Frame bounds the preparation measured on the job it compiled
   * (`preparedStartFrameBounds`). Required for a preparation that crossed the
   * worker boundary: its streamed raster rows arrive only as a recipe
   * (prepareOutputForStructuredClone), so measuring its job again would find
   * no image and refuse a Frame that matches (ADR-244 Amendment 3). */
  readonly measuredFrameBounds?: JobBounds | null;
}): string | null {
  const bounds =
    args.measuredFrameBounds === undefined
      ? preparedFrameBounds(args.prepared)
      : args.measuredFrameBounds;
  if (bounds === null) return null;
  // On a rotary that turns on Z the Frame's own `G92 Z0` moves the Z offset
  // after the Frame recorded it, as Frame completion allows (ADR-695 Amendment 5).
  const zRotary = framesZRotary(args.prepared.project);
  const recorded = args.machine.frameVerification ?? null;
  const wco = args.machine.wcoCache ?? null;
  const valid = isVerifiedFrameValid(
    zRotary && recorded !== null
      ? { ...recorded, wco: withoutRotaryZOffset(recorded.wco) }
      : recorded,
    {
      boundsSignature: frameBoundsSignature(bounds),
      wco: zRotary ? withoutRotaryZOffset(wco) : wco,
      workOriginActive: args.machine.workOriginActive === true,
    },
  );
  return valid ? null : frameVerificationBlockedMessage();
}

type PreparedOk = Extract<PreparedOutput, { readonly ok: true }>;

/** The frame-first gate for a Start preparation, from the bounds it measured. */
export function requiredFrameIssueFromStart(
  start: Parameters<typeof preparedStartFrameBounds>[0],
  machine: RequiredFrameSnapshot,
): string | null {
  return requiredFrameIssueFromPrepared({
    prepared: start.prepared,
    machine,
    measuredFrameBounds: preparedStartFrameBounds(start),
  });
}

/** What `preparedFrameBounds` gives, from the metrics the preparation took
 * of the same machine-space job while its raster rows still existed. */
export function preparedStartFrameBounds(start: {
  readonly prepared: PreparedOk;
  readonly metrics: Pick<PreparedJobMetrics, 'frameJobBounds' | 'frameMotionBounds'>;
}): JobBounds | null {
  const { frameJobBounds, frameMotionBounds } = start.metrics;
  return start.prepared.project.machine?.kind === 'cnc'
    ? frameJobBounds
    : (frameMotionBounds ?? frameJobBounds);
}

// Job Review checks the same immutable compile when it opens and again at
// Confirm, and walking a dense fill for its envelope cost ~0.2 s each time,
// between the Confirm click and the first byte (ADR-352).
const frameBoundsByPrepared = new WeakMap<PreparedOk, JobBounds | null>();

function preparedFrameBounds(prepared: PreparedOk): JobBounds | null {
  if (frameBoundsByPrepared.has(prepared)) return frameBoundsByPrepared.get(prepared) ?? null;
  const framedJob = machineSpaceJob(
    prepared.job,
    prepared.project.device,
    prepared.project.machine,
  );
  const burnBounds = computeFrameJobBounds(framedJob, prepared.project.device);
  const bounds =
    prepared.project.machine?.kind === 'cnc'
      ? burnBounds
      : (computeFrameJobMotionBounds(framedJob, prepared.project.device) ?? burnBounds);
  frameBoundsByPrepared.set(prepared, bounds);
  return bounds;
}
