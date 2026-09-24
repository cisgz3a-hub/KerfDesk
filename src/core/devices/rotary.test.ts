import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROTARY_SETUP,
  isRotaryActive,
  rotaryCircumferenceMm,
  rotaryDiameterFromCircumferenceMm,
  rotaryDiameterFromWrapLengthMm,
  rotaryMeasurementsValid,
  rotaryRevolutionTravelMm,
  rotaryUsesRollerDiameter,
  rotaryYLimitMm,
  rotaryYScale,
  type RotarySetup,
} from './rotary';

const ROLLER: RotarySetup = { ...DEFAULT_ROTARY_SETUP, enabled: true, objectDiameterMm: 80 };

describe('rotary math', () => {
  it('surface-calibrated roller (no roller diameter) transfers surface distance 1:1', () => {
    expect(rotaryUsesRollerDiameter(ROLLER)).toBe(false);
    // Exactly 1, not merely close: applyRotaryYScale short-circuits on it.
    expect(rotaryYScale(ROLLER)).toBe(1);
    expect(rotaryYLimitMm(ROLLER)).toBeCloseTo(Math.PI * 80, 6);
    // mmPerRotation has no say in a surface-calibrated roller.
    expect(rotaryYScale({ ...ROLLER, mmPerRotation: 12 })).toBe(1);
  });

  it('roller with a roller diameter scales by motion per roller turn over its circumference', () => {
    const roller = { ...ROLLER, mmPerRotation: 40, rollerDiameterMm: 25 };
    expect(rotaryUsesRollerDiameter(roller)).toBe(true);
    expect(rotaryYScale(roller)).toBeCloseTo(40 / (Math.PI * 25), 12);
    // One object revolution: the roller turns objectD/rollerD times.
    expect(rotaryYLimitMm(roller)).toBeCloseTo((40 * 80) / 25, 9);
    // The object size changes only the wrap, never the roller scale.
    expect(rotaryYScale({ ...roller, objectDiameterMm: 20 })).toBe(rotaryYScale(roller));
  });

  it('a roller whose roller circumference equals its motion per turn is 1:1', () => {
    const roller = { ...ROLLER, mmPerRotation: Math.PI * 30, rollerDiameterMm: 30 };
    expect(rotaryYScale(roller)).toBeCloseTo(1, 12);
  });

  it('chuck scales surface mm into calibrated rotation mm and ignores a roller diameter', () => {
    const chuck: RotarySetup = {
      enabled: true,
      type: 'chuck',
      mmPerRotation: 360,
      objectDiameterMm: 60,
    };
    const circumference = Math.PI * 60;
    expect(rotaryCircumferenceMm(chuck)).toBeCloseTo(circumference, 6);
    expect(rotaryYScale(chuck)).toBe(360 / circumference);
    // One revolution of emitted Y is exactly the calibrated mm/rev.
    expect(rotaryYLimitMm(chuck)).toBeCloseTo(360, 9);
    const withLeftover = { ...chuck, rollerDiameterMm: 25 };
    expect(rotaryUsesRollerDiameter(withLeftover)).toBe(false);
    expect(rotaryYScale(withLeftover)).toBe(rotaryYScale(chuck));
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
    expect(isRotaryActive({ ...ROLLER, rollerDiameterMm: 0 })).toBe(false);
    expect(isRotaryActive({ ...ROLLER, rollerDiameterMm: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isRotaryActive({ ...ROLLER, rollerDiameterMm: 25 })).toBe(true);
    // A chuck never reads the roller diameter, so a stale one cannot disable it.
    expect(rotaryMeasurementsValid({ ...ROLLER, type: 'chuck', rollerDiameterMm: 0 })).toBe(true);
  });

  it('revolution travel turns the object or the driven element once', () => {
    const roller = { ...ROLLER, mmPerRotation: 40, rollerDiameterMm: 25 };
    expect(rotaryRevolutionTravelMm(roller, 'object')).toBeCloseTo(128, 9);
    expect(rotaryRevolutionTravelMm(roller, 'drive')).toBe(40);
    expect(rotaryRevolutionTravelMm(ROLLER, 'object')).toBeCloseTo(Math.PI * 80, 9);
    expect(rotaryRevolutionTravelMm(ROLLER, 'drive')).toBeNull();
    const chuck = { ...ROLLER, type: 'chuck' as const, mmPerRotation: 360 };
    expect(rotaryRevolutionTravelMm(chuck, 'drive')).toBe(360);
    expect(rotaryRevolutionTravelMm(chuck, 'object')).toBeCloseTo(360, 9);
  });

  it('derives the diameter from a circumference or a wrapped strip', () => {
    expect(rotaryDiameterFromCircumferenceMm(Math.PI * 60)).toBeCloseTo(60, 12);
    expect(rotaryDiameterFromWrapLengthMm(Math.PI * 60, 0)).toBeCloseTo(60, 12);
    // A 0.1 mm strip reads π·0.1 ≈ 0.31 mm long; subtracting it recovers d.
    expect(rotaryDiameterFromWrapLengthMm(Math.PI * 60.1, 0.1)).toBeCloseTo(60, 12);
  });
});
