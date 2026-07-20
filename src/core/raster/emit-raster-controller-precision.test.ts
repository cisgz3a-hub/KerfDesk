import { describe, expect, it } from 'vitest';
import { emitRasterGroup, type EmitRasterInput } from './emit-raster';

function makeInput(overrides: Partial<EmitRasterInput>): EmitRasterInput {
  return {
    sValues: new Uint16Array([500]),
    width: 1,
    height: 1,
    bounds: { minX: 1, minY: 1, maxX: 1.041667, maxY: 1.1 },
    feedMmPerMin: 1000,
    overscanMm: 0,
    ...overrides,
  };
}

describe('emitRasterGroup controller-precision motion', () => {
  it('preserves world-coordinate DWC arithmetic at a rounding boundary', () => {
    const out = emitRasterGroup(
      makeInput({
        sValues: new Uint16Array([0, 500]),
        width: 2,
        bounds: { minX: 0.1, minY: 0, maxX: 0.5, maxY: 1 },
        dotWidthCorrectionMm: 0.0005,
      }),
    );

    expect(out).toMatch(/^G1 X0\.301 F1000 S0$/m);
  });

  it('drops a powered fragment that collapses at controller precision', () => {
    const out = emitRasterGroup(
      makeInput({
        dotWidthCorrectionMm: 0.0207,
      }),
    );

    expect(out).toContain('G1 X1.021 F1000 S0\nG1 X1.042');
    expect(out).not.toMatch(/^G1 X1\.021(?: F\d+)? S500$/m);
  });

  it('carries feed and power to the first real move after a rounded-away powered run', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        bounds: { minX: 0, minY: 0, maxX: 0.0016, maxY: 1 },
        sValues: new Uint16Array([500, 700, 700, 700]),
      }),
    );

    expect(out).not.toMatch(/^G1 X0\.000(?: F\d+)? S500$/m);
    expect(out).toMatch(/^G1 X0\.002 F1000 S700$/m);
  });

  it('drops controller-stationary power on reverse rows too', () => {
    const out = emitRasterGroup(
      makeInput({
        height: 2,
        dotWidthCorrectionMm: 0.0207,
        sValues: new Uint16Array([500, 500]),
        controlledLaserOffTravelFeedMmPerMin: 800,
        modalFeedrate: false,
        emitSOnEveryBurnMove: true,
      }),
    );

    expect(out.split('\n').filter((line) => /^G[01]\b/.test(line))).toEqual([
      'G1 X1.000 Y1.025 F800 S0 ; kerfdesk:laser-off-motion',
      'G1 X1.021 F1000 S0',
      'G1 X1.042 F1000 S0',
      'G1 X1.042 Y1.075 F800 S0 ; kerfdesk:laser-off-motion',
      'G1 X1.021 F1000 S0',
      'G1 X1.000 F1000 S0',
    ]);
    expect(out).not.toMatch(/^G1 X1\.021 F1000 S500$/m);
  });
});
