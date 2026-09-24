import { describe, expect, it } from 'vitest';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { cncDetectedSpindleScale } from './cnc-detected-apply';

describe('cncDetectedSpindleScale (ADR-111)', () => {
  it('reads $30 as a spindle S scale only while laser mode is off', () => {
    expect(cncDetectedSpindleScale({ maxPowerS: 24000, laserModeEnabled: false })).toBe(24000);
    expect(cncDetectedSpindleScale({ maxPowerS: 1000, laserModeEnabled: true })).toBeUndefined();
    // $32 unread: the controller has not said it is in CNC mode.
    expect(cncDetectedSpindleScale({ maxPowerS: 24000 })).toBeUndefined();
  });

  it.each<[string, Pick<ControllerSettingsSnapshot, 'maxPowerS' | 'laserModeEnabled'> | null]>([
    ['no controller settings', null],
    ['no $30', { laserModeEnabled: false }],
    ['a zero $30', { maxPowerS: 0, laserModeEnabled: false }],
    ['a negative $30', { maxPowerS: -1, laserModeEnabled: false }],
    ['a non-finite $30', { maxPowerS: Number.POSITIVE_INFINITY, laserModeEnabled: false }],
  ])('offers no spindle scale for %s', (_name, detected) => {
    expect(cncDetectedSpindleScale(detected)).toBeUndefined();
  });
});
