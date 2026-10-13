import { rotaryYScale, toSceneCoords } from '../../core/devices';
import { machineSpaceJob, rotaryAppliesTo } from '../../core/job';
import { computeFrameJobMotionBounds } from '../../core/job/job-bounds';
import { buildFramePerimeter } from '../../core/job/frame-perimeter';
import { restoreRotarySurfacePoint } from '../../core/job/rotary-transform';
import type { MotionPoint } from '../../core/job/motion-manifest';
import type { Vec2 } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';

/** Use the same represented motion envelope and perimeter order as physical
 * Frame. Rotary points are mapped back to the design surface for display. */
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
  return buildFramePerimeter(bounds, project.startPoints?.frame).map((point) => {
    if (rotary === undefined) return map({ ...point, z: 0 });
    const surface = restoreRotarySurfacePoint(
      job,
      point,
      rotaryYScale(rotary),
      rotary.reverseAxis === true,
    );
    return toSceneCoords(
      {
        x: surface.x - prepared.jobOriginOffset.x,
        y: surface.y - prepared.jobOriginOffset.y,
      },
      project.device,
    );
  });
}
