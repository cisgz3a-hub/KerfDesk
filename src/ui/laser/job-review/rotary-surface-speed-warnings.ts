import type { CutSegment, Job } from '../../../core/job';
import { machineSpaceJob, rotaryAppliesTo } from '../../../core/job';
import type { ControllerSettingsSnapshot } from '../../../core/controllers/grbl/parse-settings';
import { rotaryAxisOf } from '../../../core/devices/rotary-axis';
import {
  rotaryFeedMatchFor,
  surfaceFeedAxisShare,
  surfaceFeedDoseRise,
  type RotaryFeedMatch,
} from '../../../core/output/rotary-surface-feed';
import { rotaryTaperYFactorAt } from '../../../core/job/rotary-taper-profile';
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
  rates?: RotaryAxisRateSettings | null,
): ReadonlyArray<string> {
  if (!rotaryAppliesTo(project.device, project.machine)) return [];
  const machineJob = machineSpaceJob(job, project.device, project.machine);
  const match = rotaryFeedMatchFor(machineJob, project.device.maxFeed);
  const axisWarnings = detectRotaryAxisRateWarnings(project, machineJob, match, rates);
  if (match === undefined) return axisWarnings;
  return [...maxFeedWarnings(project, machineJob, match), ...axisWarnings];
}

function maxFeedWarnings(
  project: Parameters<typeof detectRotarySurfaceSpeedWarnings>[0],
  machineJob: Job,
  match: RotaryFeedMatch,
): ReadonlyArray<string> {
  const worst = new Map<
    string,
    { readonly speed: number; readonly rise: number; readonly x: number }
  >();
  for (const group of machineJob.groups) {
    if (group.kind !== 'cut' && group.kind !== 'fill') continue;
    const { rise, x } = largestDoseRise(group.speed, group.segments, match);
    const seen = worst.get(group.layerId);
    if (noticeable(rise) && (seen === undefined || rise > seen.rise)) {
      worst.set(group.layerId, { speed: group.speed, rise, x });
    }
  }
  return [...worst].map(([layerId, { speed, rise, x }]) => {
    const name = project.scene?.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
    // Z3-P3-2: named only when the worst held move is towards the narrow end.
    const taper = atNarrowEnd(match.taper, x) ? ', most at the narrow end of the taper' : '';
    return (
      `Layer ${name}: on this rotary its strokes round the part need more feed than the Max ` +
      `feed (${project.device.maxFeed} mm/min), so they are held there and run slower on the ` +
      `part${taper}. They burn up to ${Math.round(rise * 100)} % of the energy you set. For an ` +
      `even burn, set this layer to ${Math.floor(speed / rise)} mm/min or less.`
    );
  });
}

/** Rolling audit v14 Z3-P3-2: a rise that rounds to 100 % is not a burn
 * anyone can see (a taper's leaning rows at the Max feed itself). */
function noticeable(rise: number): boolean {
  return Math.round(rise * 100) > 100;
}

function atNarrowEnd(taper: RotaryFeedMatch['taper'], x: number): boolean {
  if (taper === undefined || taper.topRadiusMm === taper.bottomRadiusMm) return false;
  const ends =
    rotaryTaperYFactorAt(taper, taper.topX) +
    rotaryTaperYFactorAt(taper, taper.topX + taper.direction * taper.lengthMm);
  return rotaryTaperYFactorAt(taper, x) >= ends / 2;
}

function largestDoseRise(
  speed: number,
  segments: ReadonlyArray<CutSegment>,
  match: RotaryFeedMatch,
): { readonly rise: number; readonly x: number } {
  let largest = { rise: 1, x: 0 };
  for (const segment of segments) {
    const points = segment.polyline;
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined) continue;
      const rise = surfaceFeedDoseRise(speed, from, to, match);
      if (rise > largest.rise) largest = { rise, x: (from.x + to.x) / 2 };
    }
  }
  return largest;
}

/** The live controller's Z and A max rates (`$112`, `$113`); ADR-695 Amendment 1. */
export type RotaryAxisRateSettings = Pick<ControllerSettingsSnapshot, 'maxRateZ' | 'maxRateA'>;

// ADR-695 Amendment 1 (rolling audit v13 Y5-P1-4): a rotary on A or Z is also
// held by that axis's own max rate, which the controller's planner applies to
// every move whatever F asks for. Warning only: a lower F would change nothing.
function detectRotaryAxisRateWarnings(
  project: Parameters<typeof detectRotarySurfaceSpeedWarnings>[0],
  machineJob: Job,
  match: RotaryFeedMatch | undefined,
  rates: RotaryAxisRateSettings | null | undefined,
): ReadonlyArray<string> {
  const axis = rotaryAxisOf(project.device.rotary);
  if (axis === 'Y') return [];
  const rate = axis === 'A' ? rates?.maxRateA : rates?.maxRateZ;
  if (rate === undefined || !(rate > 0)) return [];
  const worst = worstAxisRiseByLayer(machineJob, match, rate);
  const setting = axis === 'A' ? '$113' : '$112';
  const unit = axis === 'A' ? '°/min' : 'mm/min';
  return [...worst].map(([layerId, { speed, rise }]) => {
    const name = project.scene?.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
    return (
      `Layer ${name}: its strokes round the part need the rotary's ${axis} axis to turn faster ` +
      `than its max rate (${setting}=${rate} ${unit}), so the controller slows them and they ` +
      `burn up to ${Math.round(rise * 100)} % of the energy you set. For an even burn, set this ` +
      `layer to ${Math.floor(speed / rise)} mm/min or less, or raise ${setting} if the rotary ` +
      'can turn faster.'
    );
  });
}

// Over the layer's moves, the largest dose rise from the Max feed hold and the
// axis rate together: the planner slows a move by share ÷ rate.
function largestAxisRise(
  speed: number,
  segments: ReadonlyArray<CutSegment>,
  match: RotaryFeedMatch | undefined,
  rate: number,
): number {
  let largest = 1;
  for (const segment of segments) {
    const points = segment.polyline;
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined) continue;
      const share = surfaceFeedAxisShare(speed, from, to, match);
      if (share <= rate) continue;
      largest = Math.max(largest, surfaceFeedDoseRise(speed, from, to, match) * (share / rate));
    }
  }
  return largest;
}

function worstAxisRiseByLayer(
  machineJob: Job,
  match: RotaryFeedMatch | undefined,
  rate: number,
): Map<string, { readonly speed: number; readonly rise: number }> {
  const worst = new Map<string, { readonly speed: number; readonly rise: number }>();
  for (const group of machineJob.groups) {
    if (group.kind !== 'cut' && group.kind !== 'fill') continue;
    const rise = largestAxisRise(group.speed, group.segments, match, rate);
    const seen = worst.get(group.layerId);
    if (noticeable(rise) && (seen === undefined || rise > seen.rise)) {
      worst.set(group.layerId, { speed: group.speed, rise });
    }
  }
  return worst;
}
