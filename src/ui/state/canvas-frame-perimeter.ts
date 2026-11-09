import { rotaryYScale, toSceneCoords } from '../../core/devices';
import { machineSpaceJob, rotaryAppliesTo } from '../../core/job';
import { computeFrameJobMotionBounds } from '../../core/job/job-bounds';
import { buildFramePerimeter } from '../../core/job/frame-perimeter';
import type { MotionPoint } from '../../core/job/motion-manifest';
import { restoreRotaryTaperPoint } from '../../core/job/rotary-taper-profile';
import { applyRotaryTaperWarp } from '../../core/job/rotary-taper-warp';
import { restoreRotarySurfacePoint } from '../../core/job/rotary-transform';
import type { Vec2 } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';

/** Use the same represented motion envelope and perimeter order as physical
 * Frame. Rotary points are mapped back to the design surface for display: the
 * Y scale first, then a tapered part's warp (ADR-694), whose inverse is linear
 * in X for a fixed machine Y, so the outline's corners map exactly. */
export function framePerimeterForCanvas(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
  map: (point: MotionPoint) => Vec2,
): ReadonlyArray<Vec2> {
  const { project, job } = prepared;
  const framedJob = machineSpaceJob(job, project.device, project.machine);
  const bounds = computeFrameJobMotionBounds(framedJob, project.device);
  if (bounds === null) return [];
  const rotary = rotaryAppliesTo(project.device, project.machine)
    ? project.device.rotary
    : undefined;
  // The Y scale is undone against the warped job, whose extent it scaled.
  const warpedJob = rotary === undefined ? job : applyRotaryTaperWarp(job, rotary);
  const taper = warpedJob.rotaryTaper;
  return buildFramePerimeter(bounds, project.startPoints?.frame).map((point) => {
    if (rotary === undefined) return map({ ...point, z: 0 });
    const warped = restoreRotarySurfacePoint(
      warpedJob,
      point,
      rotaryYScale(rotary),
      rotary.reverseAxis === true,
    );
    const surface = taper === undefined ? warped : restoreRotaryTaperPoint(taper, warped);
    return toSceneCoords(
      {
        x: surface.x - prepared.jobOriginOffset.x,
        y: surface.y - prepared.jobOriginOffset.y,
      },
      project.device,
    );
  });
}
