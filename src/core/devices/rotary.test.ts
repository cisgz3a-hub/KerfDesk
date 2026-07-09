import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROTARY_SETUP,
  isRotaryActive,
  rotaryCircumferenceMm,
  rotaryYLimitMm,
  rotaryYScale,
} from './rotary';

describe('rotary math', () => {
  it('roller transfers surface distance 1:1', () => {
    const roller = { ...DEFAULT_ROTARY_SETUP, enabled: true, objectDiameterMm: 80 };
    expect(rotaryYScale(roller)).toBe(1);
    expect(rotaryYLimitMm(roller)).toBeCloseTo(Math.PI * 80, 6);
  });

  it('chuck scales surface mm into calibrated rotation mm', () => {
    const chuck = {
      enabled: true,
      type: 'chuck' as const,
      mmPerRotation: 360,
      objectDiameterMm: 60,
    };
    const circumference = Math.PI * 60;
    expect(rotaryCircumferenceMm(chuck)).toBeCloseTo(circumference, 6);
    expect(rotaryYScale(chuck)).toBeCloseTo(360 / circumference, 9);
    // One revolution of emitted Y is exactly the calibrated mm/rev.
    expect(rotaryYLimitMm(chuck)).toBeCloseTo(360, 9);
  });

  it('isRotaryActive requires enabled + sane numbers', () => {
    expect(isRotaryActive(undefined)).toBe(false);
    expect(isRotaryActive(DEFAULT_ROTARY_SETUP)).toBe(false);
    expect(isRotaryActive({ ...DEFAULT_ROTARY_SETUP, enabled: true })).toBe(true);
    expect(isRotaryActive({ ...DEFAULT_ROTARY_SETUP, enabled: true, objectDiameterMm: 0 })).toBe(
      false,
    );
    expect(
      isRotaryActive({ ...DEFAULT_ROTARY_SETUP, enabled: true, mmPerRotation: Number.NaN }),
    ).toBe(false);
  });
});
