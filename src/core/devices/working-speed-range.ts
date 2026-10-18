// working-speed-range — the speeds a laser operation's Speed slider spans
// (ADR-615). This is a convenience range for dragging, not a firmware or
// compile limit: exact entry still accepts any speed up to device.maxFeed,
// which compile caps (feed-ceiling.tsx), and the controller still applies its
// own $110/$111 max rates.
//
// device.maxFeed alone made a poor slider top. It is a motion ceiling: the
// Falcon A1 Pro profile follows Creality's rated 600 mm/s (36000 mm/min) and
// Machine Setup allows 100000, so most of a slider that reached it described
// speeds nobody burns at. Working speeds come from vendor material guides:
//
// - Creality Falcon A1 Pro: its consumable parameter guide recommends material
//   speeds up to 10000 mm/min (falcon-profiles.ts evidence; source
//   https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/consumable-parameter-guide).
//   That covers the machine whichever module is fitted.
// - Diode: the same 10000 mm/min. xTool's D1 Pro table engraves basswood
//   plywood at 100 mm/s (6000 mm/min) with the 20 W module, and its cuts run
//   at 2-6 mm/s across the 5, 10 and 40 W modules
//   (https://uk.xtool.com/pages/material-settings, checked 2026-10-18).
// - CO2: 500 mm/s (30000 mm/min), the top of the usual 300-500 mm/s engraving
//   range; a 150 W chart engraves birch plywood at 350 mm/s and cuts at
//   15-20 mm/s (https://makerspaces.wm.edu/wp-content/uploads/2023/08/CO2-Laser-Cutter_Engraver-Settings-for-Common-Materials-150-W-2.pdf).
// - Fiber or unknown: no guide for a gantry fiber laser was found, so they take
//   the CO2 figure, the fastest gantry working speed above.
//
// The floor, 1 mm/s, is below every cut in those guides (the slowest is a
// 5 W diode at 2 mm/s). Slower speeds remain available by typing them.

import type { LaserSubProfile, LaserTechnology } from './device-profile';

export const SPEED_SLIDER_FLOOR_MM_PER_MIN = 60;

const WORKING_SPEED_MAX_BY_PROFILE_ID: Readonly<Record<string, number>> = {
  'creality-falcon-a1-pro-grblhal': 10_000,
  // "Creality Falcon-compatible GRBL diode" names its laser but carries no
  // laserSubProfile, so the type table would read it as unknown.
  'creality-falcon-a1-pro-compatible': 10_000,
};

const WORKING_SPEED_MAX_BY_TECHNOLOGY: Readonly<Record<LaserTechnology, number>> = {
  diode: 10_000,
  co2: 30_000,
  fiber: 30_000,
  unknown: 30_000,
};

/** What the range reads from a machine profile. */
export type SpeedRangeMachine = {
  readonly profileId?: string | undefined;
  readonly laserSubProfile?: Pick<LaserSubProfile, 'technology'> | undefined;
  readonly maxFeed: number;
};

export type SpeedSliderRange = {
  readonly min: number;
  readonly max: number;
};

/** The fastest speed this machine is normally run at, before its ceiling. */
export function workingSpeedMaxMmPerMin(device: Omit<SpeedRangeMachine, 'maxFeed'>): number {
  const byProfile =
    device.profileId === undefined ? undefined : WORKING_SPEED_MAX_BY_PROFILE_ID[device.profileId];
  if (byProfile !== undefined) return byProfile;
  return WORKING_SPEED_MAX_BY_TECHNOLOGY[device.laserSubProfile?.technology ?? 'unknown'];
}

/** The Speed slider's span: working speeds, never above Output max feed. */
export function speedSliderRange(device: SpeedRangeMachine): SpeedSliderRange {
  const ceiling = Number.isFinite(device.maxFeed) && device.maxFeed >= 1 ? device.maxFeed : 1;
  const max = Math.min(ceiling, workingSpeedMaxMmPerMin(device));
  return { min: Math.min(SPEED_SLIDER_FLOOR_MM_PER_MIN, max), max };
}

/**
 * Slider stops from min to max on a log scale. Laser speeds span about three
 * decades (a 2 mm/s cut, a 500 mm/s engrave), so equal steps would give every
 * cutting speed a sliver of the track. Each decade holds about 70 round
 * values: steps of 5% of the decade start up to 2x, 10% up to 5x, 25% up to
 * 10x (1000, 1050 ... 2000, 2100 ... 5000, 5250 ...). The exact ends are
 * always stops, so the slider reaches the machine's own limits.
 */
export function speedSliderStops(range: SpeedSliderRange): ReadonlyArray<number> {
  const { min, max } = range;
  if (!(max > min)) return [max];
  const stops = [min];
  let value = nextStop(min);
  while (value < max) {
    stops.push(value);
    value = nextStop(value);
  }
  // An odd ceiling (7321) replaces a round stop it nearly repeats (7250).
  const last = stops.at(-1) ?? min;
  if (stops.length > 1 && max - last < stopStep(last) / 2) stops.pop();
  stops.push(max);
  return stops;
}

function stopStep(value: number): number {
  const decade = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / decade;
  // Divide rather than multiply by 0.05: 100 * 0.05 is 5.000000000000001.
  const step = decade / (mantissa < 2 ? 20 : mantissa < 5 ? 10 : 4);
  // Below 100 mm/min the steps would be fractions; keep whole, round numbers.
  return Number.isInteger(step) ? step : Math.max(1, roundUpToOneTwoFive(step));
}

function roundUpToOneTwoFive(step: number): number {
  const scale = 10 ** Math.floor(Math.log10(step));
  const normalized = step / scale;
  if (normalized <= 1) return scale;
  if (normalized <= 2) return 2 * scale;
  if (normalized <= 5) return 5 * scale;
  return 10 * scale;
}

/** The first round stop strictly above value. */
function nextStop(value: number): number {
  const step = stopStep(value);
  const next = (Math.floor(value / step) + 1) * step;
  // Crossing into a coarser band can land between its round values.
  const coarser = stopStep(next);
  return coarser === step ? next : Math.ceil(next / coarser) * coarser;
}

/** Index of the stop nearest value on the slider's log scale; ends take values beyond them. */
export function nearestSpeedStopIndex(stops: ReadonlyArray<number>, value: number): number {
  if (!Number.isFinite(value)) return 0;
  const target = Math.log(Math.max(value, Number.MIN_VALUE));
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  stops.forEach((stop, index) => {
    const distance = Math.abs(Math.log(stop) - target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}
