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
      kerfOffsetMm: 0,
      tabsEnabled: false,
      tabSizeMm: 0.5,
      tabsPerShape: 4,
      tabSkipInnerShapes: true,
      hatchAngleDeg: 0,
      hatchSpacingMm: 0.1,
      fillOverscanMm: 5,
      fillStyle: 'scanline',
      fillBidirectional: true,
      fillCrossHatch: false,
      airAssist: false,
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

  it('defaults air assist off for every new layer', () => {
    expect(LAYER_DEFAULTS.airAssist).toBe(false);
    expect(createLayer({ id: 'L1', color: '#000000' }).airAssist).toBe(false);
  });

  it('defaults kerf compensation off for every new layer', () => {
    expect(LAYER_DEFAULTS.kerfOffsetMm).toBe(0);
    expect(createLayer({ id: 'L1', color: '#000000' }).kerfOffsetMm).toBe(0);
  });

  it('defaults automatic tabs off for every new layer', () => {
    expect(LAYER_DEFAULTS.tabsEnabled).toBe(false);
    expect(LAYER_DEFAULTS.tabSizeMm).toBe(0.5);
    expect(LAYER_DEFAULTS.tabsPerShape).toBe(4);
    expect(LAYER_DEFAULTS.tabSkipInnerShapes).toBe(true);
    expect(createLayer({ id: 'L1', color: '#000000' }).tabsEnabled).toBe(false);
  });

  it('defaults fill style to scanline so existing fill output is unchanged', () => {
    expect(LAYER_DEFAULTS.fillStyle).toBe('scanline');
    expect(createLayer({ id: 'L1', color: '#000000' }).fillStyle).toBe('scanline');
  });
});
