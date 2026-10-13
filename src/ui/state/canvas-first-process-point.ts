import { firstToolpathProcessPoint } from '../../core/job/first-process-point';
import { isEmittableCutSegment } from '../../core/job/cut-emission-resolution';
import { hasJobStartPower } from '../../core/job/job-start-power';
import type { Vec2 } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';

export function firstSurfaceProcessPoint(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
): Vec2 | null {
  // The editable Job start names the first actual burn. A zero-power layer
  // still contributes travel to the toolpath, but cannot own the cutting marker.
  const markerJob = {
    ...prepared.job,
    groups: prepared.job.groups
      .filter((group) => hasJobStartPower(group, prepared.project.device))
      .map((group) =>
        group.kind === 'cut'
          ? { ...group, segments: group.segments.filter(isEmittableCutSegment) }
          : group,
      ),
  };
  return firstToolpathProcessPoint(markerJob, {
    scanningOffsets: prepared.project.device.scanningOffsets,
    bedSizeMm: {
      widthMm: prepared.project.device.bedWidth,
      heightMm: prepared.project.device.bedHeight,
    },
  });
}
