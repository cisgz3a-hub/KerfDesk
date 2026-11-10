import type { ControllerSettingsSnapshot } from '../../../core/controllers/grbl/parse-settings';
import { rotaryYScale } from '../../../core/devices';
import { rotaryAxisOf } from '../../../core/devices/rotary-axis';
import type { Job } from '../../../core/job';
import { rotaryAppliesTo } from '../../../core/job';
import type { Project } from '../../../core/scene';

/** The live controller's Z and A max rates (`$112`, `$113`); ADR-695 Amendment 1. */
export type RotaryAxisRateSettings = Pick<ControllerSettingsSnapshot, 'maxRateZ' | 'maxRateA'>;

/** ADR-127 Amendment 2: each move's feed is matched so the part's surface
 * moves at the layer speed. A roller that needs more than one machine mm per
 * surface mm (Y scale above 1) asks the controller for more feed round the
 * part than along it; past the profile's Max feed the emitter holds the feed
 * there, and those strokes run slower on the part and burn darker. A rotary
 * on a dedicated A or Z axis is also held by that axis's own max rate, which
 * the controller's planner applies to every move whatever F says (ADR-695
 * Amendment 1). Only layers with a stroke round the part are named. Exact
 * prepared-job disclosure only; it never changes output or blocks Start. */
export function detectRotarySurfaceSpeedWarnings(
  project: Pick<Project, 'device' | 'machine'>,
  job: Job,
  rates?: RotaryAxisRateSettings | null,
): ReadonlyArray<string> {
  const rotary = project.device.rotary;
  if (!rotaryAppliesTo(project.device, project.machine) || rotary === undefined) return [];
  const scale = rotaryYScale(rotary);
  const fastest = fastestRoundLayer(job);
  if (!(scale > 0) || fastest === 0) return [];
  const axis = rotaryAxisOf(rotary);
  const maxFeed = project.device.maxFeed;
  const overMaxFeed = scale > 1 && maxFeed > 0 && fastest * scale > maxFeed;
  return [
    ...(overMaxFeed ? [maxFeedWarning(axis, scale, fastest, maxFeed)] : []),
    ...(axis === 'Y' ? [] : axisRateWarnings(axis, scale, fastest, rates)),
  ];
}

// ADR-695 Amendment 1: the controller caps every move at the rotary axis's own
// max rate, whatever F asks for.
function axisRateWarnings(
  axis: 'A' | 'Z',
  scale: number,
  fastest: number,
  rates: RotaryAxisRateSettings | null | undefined,
): string[] {
  const rate = axis === 'A' ? rates?.maxRateA : rates?.maxRateZ;
  if (rate === undefined || !(rate > 0) || fastest * scale <= rate) return [];
  return [axisRateWarning(axis, scale, fastest, rate)];
}

// The fastest cut or fill layer with a stroke that turns the part; a stroke
// along X (a 0° fill, an image row) never asks the rotary for feed.
function fastestRoundLayer(job: Job): number {
  let fastest = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cut' && group.kind !== 'fill') continue;
    if (group.speed <= fastest) continue;
    if (group.segments.some((segment) => turnsThePart(segment.polyline))) fastest = group.speed;
  }
  return fastest;
}

function turnsThePart(polyline: ReadonlyArray<{ readonly y: number }>): boolean {
  for (let i = 1; i < polyline.length; i += 1) {
    if (Math.abs((polyline[i]?.y ?? 0) - (polyline[i - 1]?.y ?? 0)) > 1e-6) return true;
  }
  return false;
}

function maxFeedWarning(axis: string, scale: number, fastest: number, maxFeed: number): string {
  const held = Math.floor(maxFeed / scale);
  if (axis === 'Y') {
    return (
      `This rotary turns Y ×${scale.toFixed(2)}, so a ${fastest} mm/min stroke round the part ` +
      `needs ${Math.ceil(fastest * scale)} mm/min of Y feed, more than the Max feed ` +
      `(${maxFeed} mm/min). Strokes round the part run at ${held} mm/min on its ` +
      `surface and burn darker than strokes along it. For an even burn, set the vector ` +
      `layers to ${held} mm/min or less.`
    );
  }
  return (
    `This rotary turns ${axisPerMm(axis, scale)}, so a ${fastest} mm/min stroke round the ` +
    `part needs ${Math.ceil(fastest * scale)} ${rateUnit(axis)} of ${axis} feed, more than the ` +
    `Max feed (${maxFeed}). Strokes round the part run at ${held} mm/min on its surface and ` +
    `burn darker than strokes along it. For an even burn, set the vector layers to ${held} ` +
    'mm/min or less.'
  );
}

function axisRateWarning(axis: 'A' | 'Z', scale: number, fastest: number, rate: number): string {
  const held = Math.floor(rate / scale);
  const setting = axis === 'A' ? '$113' : '$112';
  return (
    `This rotary turns ${axisPerMm(axis, scale)}, so a ${fastest} mm/min stroke round the ` +
    `part needs ${Math.ceil(fastest * scale)} ${rateUnit(axis)} of ${axis}, more than the ` +
    `controller's ${axis} max rate (${setting}=${rate}). The controller slows those strokes, so ` +
    `they run at ${held} mm/min on the part's surface and burn darker. For an even burn, set the ` +
    `vector layers to ${held} mm/min or less, or raise ${setting} if the rotary can turn faster.`
  );
}

function axisPerMm(axis: string, scale: number): string {
  return axis === 'A' ? `A ${scale.toFixed(2)}° per mm of surface` : `${axis} ×${scale.toFixed(2)}`;
}

function rateUnit(axis: string): string {
  return axis === 'A' ? '°/min' : 'mm/min';
}
