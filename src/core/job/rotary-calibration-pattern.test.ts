import { describe, expect, it } from 'vitest';
import { compileJob } from './compile-job';
import { generateRotaryCalibrationPattern } from './rotary-calibration-pattern';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../devices';

const SETUP: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

describe('generateRotaryCalibrationPattern', () => {
  it('creates a measurable crosshair rectangle inside half a revolution', () => {
    const pattern = generateRotaryCalibrationPattern(SETUP);

    expect(pattern.widthMm).toBe(50);
    expect(pattern.heightMm).toBe(20);
    expect(pattern.scene.objects).toHaveLength(1);
    const object = pattern.scene.objects[0];
    expect(object?.kind).toBe('imported-svg');
    if (object?.kind !== 'imported-svg') throw new Error('calibration vector missing');
    expect(object.paths[0]?.polylines).toHaveLength(3);
    expect(pattern.scene.layers[0]).toMatchObject({ mode: 'line', power: 10, speed: 1500 });
    expect(compileJob(pattern.scene, DEFAULT_DEVICE_PROFILE).groups).not.toHaveLength(0);
  });

  it('shrinks the Y measurement for a cylinder with a very small circumference', () => {
    const pattern = generateRotaryCalibrationPattern({ ...SETUP, objectDiameterMm: 5 });

    expect(pattern.heightMm).toBeCloseTo((Math.PI * 5) / 2, 6);
  });
});
