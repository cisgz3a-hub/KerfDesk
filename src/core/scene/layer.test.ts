import { describe, expect, it } from 'vitest';
import { createLayer, LAYER_DEFAULTS } from './layer';

describe('createLayer', () => {
  it('applies WORKFLOW.md F-A7 defaults (power 30, speed 1500, passes 1, visible+output on, mode line) plus F.1 hatch defaults', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    expect(layer).toEqual({
      id: 'L1',
      color: '#ff0000',
      mode: 'line',
      minPower: 0,
      power: 30,
      speed: 1500,
      passes: 1,
      visible: true,
      output: true,
      hatchAngleDeg: 0,
      hatchSpacingMm: 0.1,
      fillOverscanMm: 5,
      fillBidirectional: true,
      ditherAlgorithm: 'floyd-steinberg',
      linesPerMm: 10,
      negativeImage: false,
      passThrough: false,
      dotWidthCorrectionMm: 0,
    });
  });

  it('preserves the provided id and color', () => {
    const layer = createLayer({ id: 'custom', color: '#0066cc' });
    expect(layer.id).toBe('custom');
    expect(layer.color).toBe('#0066cc');
  });
});

describe('LAYER_DEFAULTS', () => {
  it('is frozen at compile time via `as const`', () => {
    // Type-level guarantee covered by `as const satisfies …`. Runtime sanity:
    expect(LAYER_DEFAULTS.passes).toBeGreaterThanOrEqual(1);
    expect(LAYER_DEFAULTS.power).toBeGreaterThanOrEqual(0);
    expect(LAYER_DEFAULTS.power).toBeLessThanOrEqual(100);
    expect(LAYER_DEFAULTS.minPower).toBeGreaterThanOrEqual(0);
    expect(LAYER_DEFAULTS.minPower).toBeLessThanOrEqual(LAYER_DEFAULTS.power);
  });
});
