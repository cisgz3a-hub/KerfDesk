import { describe, expect, it } from 'vitest';
import { createLayer } from '../scene';
import { effectiveObjectPowerPercent, objectPowerScalePercent } from './object-power-scale';

describe('object power scale helpers', () => {
  it('treats a missing shape power scale as 100 percent', () => {
    expect(objectPowerScalePercent({})).toBe(100);
  });

  it('clamps malformed scale values before applying layer power', () => {
    expect(objectPowerScalePercent({ powerScale: -10 })).toBe(0);
    expect(objectPowerScalePercent({ powerScale: 150 })).toBe(100);
  });

  it('applies object scale to clamped layer power', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), power: 30 };

    expect(effectiveObjectPowerPercent(layer, { powerScale: 50 })).toBe(15);
  });
});
