import { describe, expect, it } from 'vitest';
import { emitRasterGroup, type EmitRasterInput } from './emit-raster';

function makeInput(overrides: Partial<EmitRasterInput> = {}): EmitRasterInput {
  return {
    sValues: overrides.sValues ?? new Uint16Array(4),
    width: 2,
    height: 2,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    feedMmPerMin: 6000,
    overscanMm: 0,
    layerId: 'L1',
    color: '#000000',
    powerPercent: 80,
    ...overrides,
  };
}

describe('emitRasterGroup scan-offset compensation', () => {
  it('shifts only reverse rows by scan offset, including overscan coordinates', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 2,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
        overscanMm: 1,
        scanOffsetMm: 0.25,
        sValues: new Uint16Array([500, 500, 0, 0, 0, 0, 700, 700]),
      }),
    );

    const motion = out.split('\n').filter((line) => line.startsWith('G'));
    expect(motion).toEqual([
      'G0 X-1.000 Y0.500 S0',
      'G1 X0.000 F6000 S0',
      'G1 X2.000 S500',
      'G1 X3.000 S0',
      'G0 X4.750 Y1.500 S0',
      'G1 X3.750 S0',
      'G1 X1.750 S700',
      'G1 X0.750 S0',
    ]);
  });

  it('applies scan offset to every corrected reverse-row X coordinate', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 2,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
        overscanMm: 0,
        dotWidthCorrectionMm: 0.25,
        scanOffsetMm: 0.25,
        sValues: new Uint16Array([500, 500, 0, 0, 0, 500, 500, 0]),
      }),
    );

    const motion = out.split('\n').filter((line) => line.startsWith('G'));
    expect(motion.slice(4)).toEqual([
      'G0 X2.750 Y1.500 S0',
      'G1 X2.500 S0',
      'G1 X1.000 S500',
      'G1 X0.750 S0',
    ]);
  });

  it('does not apply scan offset when bidirectional scanning is disabled', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 2,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
        scanOffsetMm: 0.25,
        bidirectional: false,
        sValues: new Uint16Array([500, 500, 0, 0, 0, 0, 700, 700]),
      }),
    );

    const motion = out.split('\n').filter((line) => line.startsWith('G'));
    expect(motion).toEqual([
      'G0 X0.000 Y0.500 S0',
      'G1 X2.000 F6000 S500',
      'G1 X2.000 S0',
      'G0 X2.000 Y1.500 S0',
      'G1 X4.000 S700',
      'G1 X4.000 S0',
    ]);
  });
});
