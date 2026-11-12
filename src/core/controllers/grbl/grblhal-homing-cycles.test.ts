// grblHAL's `$44`-`$49` homing passes as one mask of the axes a Home covers
// (ADR-322 Amendment 4).
import { describe, expect, it } from 'vitest';
import { grblHalSettingsMap } from '../../../__fixtures__/controllers/grblhal-settings-dump';
import { defaultGrblSimSettings } from '../../../__fixtures__/controllers';
import { homingCycleAxesField } from './grblhal-homing-cycles';
import { settingsMapToControllerSettings } from './parse-settings';

describe('homing pass axes', () => {
  it.each<[string, Record<number, string>, number]>([
    ['the grblHAL default: Z, then X and Y', { 44: '4', 45: '3' }, 7],
    ['X and Y in separate passes', { 44: '1', 45: '2' }, 3],
    ['X only', { 44: '1', 45: '0', 46: '0' }, 1],
    ['a fourth axis in a later pass', { 44: '3', 47: '8' }, 11],
    ['no axis in any pass', { 44: '0' }, 0],
  ])('%s', (_label, passes, mask) => {
    const map = new Map(Object.entries(passes).map(([id, value]) => [Number(id), value]));
    expect(homingCycleAxesField(map)).toEqual({ homingCycleAxesMask: mask });
  });

  it('reports nothing when the dump lists no pass, as stock GRBL and FluidNC do', () => {
    expect(homingCycleAxesField(defaultGrblSimSettings())).toEqual({});
    expect(
      settingsMapToControllerSettings(defaultGrblSimSettings()).homingCycleAxesMask,
    ).toBeUndefined();
  });

  it('reports nothing when a pass is not a whole-number mask', () => {
    for (const bad of ['X', '1.5', '-1', '']) {
      expect(homingCycleAxesField(new Map([[44, bad]]))).toEqual({});
    }
  });

  it('reaches the controller settings snapshot', () => {
    const settings = settingsMapToControllerSettings(grblHalSettingsMap({ 44: '4', 45: '3' }));
    expect(settings.homingCycleAxesMask).toBe(7);
  });
});
