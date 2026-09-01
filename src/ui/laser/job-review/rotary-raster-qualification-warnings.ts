import type { Job } from '../../../core/job';
import { rotaryAppliesTo } from '../../../core/job';
import type { Project } from '../../../core/scene';

export const ROTARY_RASTER_QUALIFICATION_WARNING =
  'This reviewed job includes raster output on an active rotary. Frame verifies the commanded ' +
  'motion envelope only; it does not verify rotary scale or direction, seam placement, focus, ' +
  'workholding, slip, backlash, or material response. Qualify those physical results with a ' +
  'supervised low-risk test.';

/** Exact prepared-job disclosure only. It must never participate in output,
 * preflight, Frame permit identity, or Start authorization. */
export function detectRotaryRasterQualificationWarnings(
  project: Pick<Project, 'device' | 'machine'>,
  job: Job,
): ReadonlyArray<string> {
  if (!rotaryAppliesTo(project.device, project.machine)) return [];
  return job.groups.some((group) => group.kind === 'raster')
    ? [ROTARY_RASTER_QUALIFICATION_WARNING]
    : [];
}
