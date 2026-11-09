import { rotaryYScale } from '../../../core/devices';
import type { Job } from '../../../core/job';
import { rotaryAppliesTo } from '../../../core/job';
import type { Project } from '../../../core/scene';

/** ADR-127 Amendment 2: each move's feed is matched so the part's surface
 * moves at the layer speed. A roller that needs more than one machine mm per
 * surface mm (Y scale above 1) asks the controller for more feed round the
 * part than along it; past the profile's Max feed the emitter holds the feed
 * there, and those strokes run slower on the part and burn darker. Exact
 * prepared-job disclosure only; it never changes output or blocks Start. */
export function detectRotarySurfaceSpeedWarnings(
  project: Pick<Project, 'device' | 'machine'>,
  job: Job,
): ReadonlyArray<string> {
  const rotary = project.device.rotary;
  if (!rotaryAppliesTo(project.device, project.machine) || rotary === undefined) return [];
  const scale = rotaryYScale(rotary);
  const maxFeed = project.device.maxFeed;
  if (!(scale > 1) || !(maxFeed > 0)) return [];
  let fastest = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cut' && group.kind !== 'fill') continue;
    if (group.speed * scale > maxFeed) fastest = Math.max(fastest, group.speed);
  }
  if (fastest === 0) return [];
  const heldMmPerMin = Math.floor(maxFeed / scale);
  return [
    `This rotary turns Y ×${scale.toFixed(2)}, so a ${fastest} mm/min stroke round the part ` +
      `needs ${Math.ceil(fastest * scale)} mm/min of Y feed, more than the Max feed ` +
      `(${maxFeed} mm/min). Strokes round the part run at ${heldMmPerMin} mm/min on its ` +
      `surface and burn darker than strokes along it. For an even burn, set the vector ` +
      `layers to ${heldMmPerMin} mm/min or less.`,
  ];
}
