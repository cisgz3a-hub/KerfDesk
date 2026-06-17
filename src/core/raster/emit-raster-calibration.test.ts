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

describe('emitRasterGroup scan calibration', () => {
  it('applies scan calibration offsets in opposite directions for bidirectional rows', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 2,
        height: 2,
        bounds: { minX: 10, minY: 0, maxX: 12, maxY: 2 },
        sValues: new Uint16Array([100, 100, 100, 100]),
        initialXOffsetMm: 0.1,
        bidirectionalScanOffsetMm: 0.25,
      }),
    );

    expect(motionLines(out)).toEqual([
      'G0 X10.350 Y0.500 S0',
      'G1 X12.350 F6000 S100',
      'G1 X12.350 S0',
      'G0 X11.850 Y1.500 S0',
      'G1 X9.850 S100',
      'G1 X9.850 S0',
    ]);
  });

  it('can emit unidirectional raster rows for scan-offset diagnosis', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 2,
        height: 2,
        bounds: { minX: 10, minY: 0, maxX: 12, maxY: 2 },
        sValues: new Uint16Array([100, 100, 200, 200]),
        bidirectional: false,
      }),
    );

    expect(motionLines(out)).toEqual([
      'G0 X10.000 Y0.500 S0',
      'G1 X12.000 F6000 S100',
      'G1 X12.000 S0',
      'G0 X10.000 Y1.500 S0',
      'G1 X12.000 S200',
      'G1 X12.000 S0',
    ]);
  });
});

function motionLines(gcode: string): ReadonlyArray<string> {
  return gcode.split('\n').filter((line) => line.startsWith('G'));
}
