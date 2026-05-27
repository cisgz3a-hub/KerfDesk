// estimateJobDuration — predict how long a Job will take to burn.
//
// Pure function over the Job IR (post-compile, machine coords) + DeviceProfile.
// Mirrors the motion model GrblStrategy actually emits:
//
//   For each group (output-enabled layer):
//     For each pass (1..group.passes):
//       For each segment:
//         G0 from previous-end → segment.first   at device.maxFeed   (laser off)
//         G1 along segment.polyline              at group.speed      (cutting)
//   G0 back to (0,0)                             at device.maxFeed   (postamble park)
//
// What v1 *does not* model:
//   * GRBL acceleration ($120/$121) — short moves take longer than
//     length/feed predicts. Typical overhead is small for designs with
//     long cuts, dominant for designs full of tiny dotted polylines.
//   * Per-line stream-handshake overhead — millisecond-scale, negligible
//     for jobs above ~10s.
//   * Preamble/postamble homing or autofocus time — those are user
//     actions, not in the streamed Job.
//
// Net effect: real burn time tends to be 5-25% longer than this estimate
// on detail-heavy work, within ~5% on long simple cuts. Surfaced in the
// UI with a "≈" prefix to set expectations.
//
// Pure-core compliant: no clock reads, no Math.random, no I/O.

import type { DeviceProfile } from '../devices';
import type { Vec2 } from '../scene';
import type { Job } from './job';

export type JobDurationEstimate = {
  readonly totalSeconds: number;
  readonly breakdown: {
    readonly cutSeconds: number;
    readonly travelSeconds: number;
  };
};

const SECONDS_PER_MINUTE = 60;
const ORIGIN: Vec2 = { x: 0, y: 0 };

export function estimateJobDuration(job: Job, device: DeviceProfile): JobDurationEstimate {
  const travelFeed = Math.max(1, device.maxFeed);
  let cutSeconds = 0;
  let travelSeconds = 0;
  let cursor: Vec2 = ORIGIN;

  for (const group of job.groups) {
    const cutFeed = Math.max(1, Math.min(group.speed, device.maxFeed));
    for (let pass = 0; pass < group.passes; pass += 1) {
      for (const seg of group.segments) {
        const first = seg.polyline[0];
        if (first === undefined) continue;
        travelSeconds += distance(cursor, first) / travelFeed * SECONDS_PER_MINUTE;
        cutSeconds += polylineLength(seg.polyline) / cutFeed * SECONDS_PER_MINUTE;
        const last = seg.polyline[seg.polyline.length - 1];
        if (last !== undefined) cursor = last;
      }
    }
  }

  // Postamble park: G0 X0 Y0 — only relevant if anything was cut.
  if (cursor !== ORIGIN) {
    travelSeconds += distance(cursor, ORIGIN) / travelFeed * SECONDS_PER_MINUTE;
  }

  return {
    totalSeconds: cutSeconds + travelSeconds,
    breakdown: { cutSeconds, travelSeconds },
  };
}

function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function polylineLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev === undefined || curr === undefined) continue;
    total += distance(prev, curr);
  }
  return total;
}

// Human-readable formatter — "4m 23s" / "47s" / "1h 12m". Co-located with
// the estimate so callers don't reinvent the math; reused by JobControls
// and any future status display.
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.round(safe % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
