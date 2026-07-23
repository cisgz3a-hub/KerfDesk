// Park-rapid Frame disclosure (rule 7 / ADR-228): Frame traces the job's
// motion envelope (computeJobMotionBounds over the job groups), but the
// postamble park rapid is not part of that envelope. When the resolved park
// target lies outside it, the job's final move exits the framed outline —
// Job Review says so here, with the exact coordinates. Warning only: it
// informs the operator and never refuses Frame or Start.

import type { DeviceProfile } from '../../../core/devices';
import { computeJobMotionBounds, type Job, type JobBounds } from '../../../core/job';
import { resolveJobParkTarget, type OutputEmitOptions } from '../../../core/output';
import type { MachineKind, Vec2 } from '../../../core/scene';
import { formatMm } from './job-review-format';

// Static body of the advisory; the park coordinates are the only
// interpolated part (CLAUDE.md: messages are named constants).
const PARK_OUTSIDE_FRAME_WARNING_BODY =
  'outside the framed outline. Frame traces only the job motion area, so this final move was ' +
  'not part of the Frame pass — keep the travel path to that point clear.';

export function parkOutsideFrameWarning(park: Vec2): string {
  return (
    `After the job finishes, the head will rapid to its park point at ` +
    `X ${formatMm(park.x)} · Y ${formatMm(park.y)} mm — ${PARK_OUTSIDE_FRAME_WARNING_BODY}`
  );
}

/** Advisory when the postamble park rapid lands outside the framed motion
 * bounds. Resolves the park point with the emitters' own precedence
 * (resolveJobParkTarget) against the same bounds the frame plan traces. */
export function detectParkOutsideFrameWarnings(
  job: Job,
  device: DeviceProfile,
  machineKind: MachineKind,
  finishPosition: OutputEmitOptions['finishPosition'],
): ReadonlyArray<string> {
  const bounds = computeJobMotionBounds(job, device);
  const park = resolveJobParkTarget(job, device, machineKind, finishPosition);
  return detectParkOutsideFrameWarningsFromMetrics(bounds, park);
}

export function detectParkOutsideFrameWarningsFromMetrics(
  bounds: JobBounds | null,
  park: Vec2 | null,
): ReadonlyArray<string> {
  if (bounds === null) return [];
  if (park === null || containsPoint(bounds, park)) return [];
  return [parkOutsideFrameWarning(park)];
}

function containsPoint(bounds: JobBounds, point: Vec2): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}
