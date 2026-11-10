import type { CutSegment, Job } from '../../../core/job';
import { machineSpaceJob, rotaryAppliesTo } from '../../../core/job';
import {
  rotaryFeedMatchFor,
  surfaceFeedDoseRise,
  type RotaryFeedMatch,
} from '../../../core/output/rotary-surface-feed';
import type { Project } from '../../../core/scene';

/** ADR-127 Amendment 2: each move's feed is matched so the part's surface
 * moves at the layer speed. A stroke round the part that needs more feed than
 * the profile's Max feed is held there, so it runs slower on the part and
 * burns darker (D4). Rolling audit v13 Y5-P2-1 / Y5-P3-1: the check reads the
 * job's own moves through the emitter's feed maths, so a taper's narrow end
 * and a k <= 1 roller count, a stroke along X never does, and the words name
 * no axis or unit. Exact prepared-job disclosure only; it never changes
 * output or blocks Start. */
export function detectRotarySurfaceSpeedWarnings(
  project: Pick<Project, 'device' | 'machine'> & {
    readonly scene?: Pick<Project['scene'], 'layers'>;
  },
  job: Job,
): ReadonlyArray<string> {
  if (!rotaryAppliesTo(project.device, project.machine)) return [];
  const machineJob = machineSpaceJob(job, project.device, project.machine);
  const match = rotaryFeedMatchFor(machineJob, project.device.maxFeed);
  if (match === undefined) return [];
  const worst = new Map<string, { readonly speed: number; readonly rise: number }>();
  for (const group of machineJob.groups) {
    if (group.kind !== 'cut' && group.kind !== 'fill') continue;
    const rise = largestDoseRise(group.speed, group.segments, match);
    const seen = worst.get(group.layerId);
    if (rise > 1 && (seen === undefined || rise > seen.rise)) {
      worst.set(group.layerId, { speed: group.speed, rise });
    }
  }
  const taper = match.taper === undefined ? '' : ', most at the narrow end of the taper';
  return [...worst].map(([layerId, { speed, rise }]) => {
    const name = project.scene?.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
    return (
      `Layer ${name}: on this rotary its strokes round the part need more feed than the Max ` +
      `feed (${project.device.maxFeed} mm/min), so they are held there and run slower on the ` +
      `part${taper}. They burn up to ${Math.round(rise * 100)} % of the energy you set. For an ` +
      `even burn, set this layer to ${Math.floor(speed / rise)} mm/min or less.`
    );
  });
}

function largestDoseRise(
  speed: number,
  segments: ReadonlyArray<CutSegment>,
  match: RotaryFeedMatch,
): number {
  let largest = 1;
  for (const segment of segments) {
    const points = segment.polyline;
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined) continue;
      largest = Math.max(largest, surfaceFeedDoseRise(speed, from, to, match));
    }
  }
  return largest;
}
