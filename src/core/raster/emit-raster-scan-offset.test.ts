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
  // ADR-052 Amendment 2: every row of a two-way scan moves half the table value
  // along its own travel, forward rows +X and reverse rows -X, as LightBurn does.
  it('moves forward and reverse rows half the scan offset each, including overscan coordinates', () => {
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
      'G0 X-0.875 Y0.500 S0',
      'G1 X0.125 F6000 S0 ; kerfdesk:laser-off-motion',
      'G1 X2.125 S500',
      'G1 X3.125 S0 ; kerfdesk:laser-off-motion',
      'G0 X4.875 Y1.500 S0',
      'G1 X3.875 S0 ; kerfdesk:laser-off-motion',
      'G1 X1.875 S700',
      'G1 X0.875 S0 ; kerfdesk:laser-off-motion',
    ]);
  });

  // A negative table moves each row against its travel: forward -X, reverse +X.
  it('moves each row against its travel for a negative scan offset', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 2,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
        overscanMm: 1,
        scanOffsetMm: -0.25,
        sValues: new Uint16Array([500, 500, 0, 0, 0, 0, 700, 700]),
      }),
    );

    const motion = out.split('\n').filter((line) => line.startsWith('G'));
    expect(motion).toEqual([
      'G0 X-1.125 Y0.500 S0',
      'G1 X-0.125 F6000 S0 ; kerfdesk:laser-off-motion',
      'G1 X1.875 S500',
      'G1 X2.875 S0 ; kerfdesk:laser-off-motion',
      'G0 X5.125 Y1.500 S0',
      'G1 X4.125 S0 ; kerfdesk:laser-off-motion',
      'G1 X2.125 S700',
      'G1 X1.125 S0 ; kerfdesk:laser-off-motion',
    ]);
  });

  it('applies half the scan offset to every corrected reverse-row X coordinate', () => {
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
      'G0 X2.875 Y1.500 S0',
      'G1 X2.625 S0',
      'G1 X1.125 S500',
      'G1 X0.875 S0',
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
