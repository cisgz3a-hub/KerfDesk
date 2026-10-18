import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import { FALCON_A1_PRO_INFRARED_2W_MODULE } from './laser-modules';
import { XTOOL_D1_PRO_PROFILES } from './brand-laser-profiles';
import {
  nearestSpeedStopIndex,
  SPEED_SLIDER_FLOOR_MM_PER_MIN,
  speedSliderRange,
  speedSliderStops,
} from './working-speed-range';

describe('speedSliderRange', () => {
  it('stops the Falcon A1 Pro at Creality’s working speed, not its rated 600 mm/s', () => {
    expect(FALCON_A1_PRO_GRBLHAL_PROFILE.maxFeed).toBe(36_000);
    expect(speedSliderRange(FALCON_A1_PRO_GRBLHAL_PROFILE)).toEqual({ min: 60, max: 10_000 });
  });

  it('keeps the machine’s figure whichever module is fitted', () => {
    const infrared = {
      ...FALCON_A1_PRO_GRBLHAL_PROFILE,
      laserSubProfile: FALCON_A1_PRO_INFRARED_2W_MODULE,
    };
    expect(speedSliderRange(infrared).max).toBe(10_000);
  });

  it('keeps the Falcon-compatible diode at the diode maximum when its ceiling is raised', () => {
    expect(FALCON_COMPATIBLE_PROFILE.laserSubProfile).toBeUndefined();
    const raised = { ...FALCON_COMPATIBLE_PROFILE, maxFeed: 36_000 };
    expect(speedSliderRange(raised).max).toBe(10_000);
  });

  it('never runs past Output max feed', () => {
    const xtool = XTOOL_D1_PRO_PROFILES[0]!;
    expect(xtool.maxFeed).toBe(6000);
    expect(speedSliderRange(xtool)).toEqual({ min: 60, max: 6000 });
  });

  it('caps a raised ceiling at the laser type’s working speed', () => {
    const diode = { ...XTOOL_D1_PRO_PROFILES[0]!, maxFeed: 100_000 };
    const co2 = { maxFeed: 100_000, laserSubProfile: { technology: 'co2' as const } };
    expect(speedSliderRange(diode).max).toBe(10_000);
    expect(speedSliderRange(co2).max).toBe(30_000);
    expect(speedSliderRange({ ...DEFAULT_DEVICE_PROFILE, maxFeed: 100_000 }).max).toBe(30_000);
  });

  it('lowers the floor rather than invert the range on a very slow ceiling', () => {
    expect(speedSliderRange({ ...DEFAULT_DEVICE_PROFILE, maxFeed: 40 })).toEqual({
      min: 40,
      max: 40,
    });
    expect(speedSliderRange({ ...DEFAULT_DEVICE_PROFILE, maxFeed: Number.NaN })).toEqual({
      min: 1,
      max: 1,
    });
  });
});

describe('speedSliderStops', () => {
  it('spaces round values evenly on a log scale and keeps both exact ends', () => {
    const stops = speedSliderStops({ min: SPEED_SLIDER_FLOOR_MM_PER_MIN, max: 10_000 });
    expect(stops[0]).toBe(60);
    expect(stops.at(-1)).toBe(10_000);
    expect(stops.slice(0, 4)).toEqual([60, 65, 70, 75]);
    expect(stops).toEqual(expect.arrayContaining([100, 105, 200, 210, 500, 525, 1000, 1050]));
    expect(stops).toEqual(expect.arrayContaining([2000, 2100, 3000, 5000, 5250, 6000]));
    for (let index = 1; index < stops.length; index += 1) {
      const ratio = stops[index]! / stops[index - 1]!;
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThanOrEqual(1.09);
    }
  });

  it('gives a cutting speed a fair share of the track', () => {
    const stops = speedSliderStops({ min: 60, max: 10_000 });
    // 600 mm/min (10 mm/s) sits near the middle, not at 6% as on a linear track.
    const position = stops.indexOf(600) / (stops.length - 1);
    expect(position).toBeGreaterThan(0.4);
    expect(position).toBeLessThan(0.5);
  });

  it('ends on an odd controller-reported ceiling', () => {
    const stops = speedSliderStops({ min: 60, max: 7321 });
    expect(stops.slice(-3)).toEqual([6750, 7000, 7321]);
  });

  it('collapses to one stop when there is no range', () => {
    expect(speedSliderStops({ min: 40, max: 40 })).toEqual([40]);
  });
});

describe('nearestSpeedStopIndex', () => {
  const stops = speedSliderStops({ min: 60, max: 10_000 });

  it('finds the stop nearest on the log scale and pins values beyond the ends', () => {
    expect(stops[nearestSpeedStopIndex(stops, 1234)]).toBe(1250);
    expect(stops[nearestSpeedStopIndex(stops, 3000)]).toBe(3000);
    expect(nearestSpeedStopIndex(stops, 1)).toBe(0);
    expect(nearestSpeedStopIndex(stops, 36_000)).toBe(stops.length - 1);
    expect(nearestSpeedStopIndex(stops, Number.NaN)).toBe(0);
  });
});
