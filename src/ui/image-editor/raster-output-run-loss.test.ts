import { describe, expect, it } from 'vitest';
import type { RasterGroup } from '../../core/job';
import { rasterOutputRunLoss } from './raster-output-run-loss';

function group(values: ReadonlyArray<number>, overrides: Partial<RasterGroup> = {}): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'L1',
    sourceObjectId: 'R1',
    color: '#808080',
    power: 100,
    speed: 1000,
    passes: 1,
    airAssist: false,
    sValues: Uint16Array.from(values),
    pixelWidth: values.length,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: values.length, maxY: 1 },
    overscanMm: 0,
    dotWidthCorrectionMm: 0.75,
    bidirectional: false,
    ...overrides,
  };
}

describe('rasterOutputRunLoss', () => {
  it('splits adjacent pixels by exact S before evaluating full removal', () => {
    expect(
      rasterOutputRunLoss(group([1000, 608]), {
        shouldCaptureMask: true,
      }),
    ).toEqual({
      mask: { width: 2, height: 1, alpha: Uint8Array.of(255, 255) },
      pixels: 2,
    });
  });

  it('retains a wider equal-power run when a positive segment survives', () => {
    expect(
      rasterOutputRunLoss(group([1000, 1000]), {
        shouldCaptureMask: true,
      }),
    ).toEqual({
      mask: null,
      pixels: 0,
    });
  });

  it('consumes a forward-only provider once in source order', () => {
    const calls: number[] = [];
    const streamed = group([], {
      sValues: new Uint16Array(0),
      pixelWidth: 1,
      pixelHeight: 2,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 2 },
      passes: 9,
      rowProvider: (y) => {
        calls.push(y);
        return Uint16Array.of(1000);
      },
    });
    expect(rasterOutputRunLoss(streamed, { shouldCaptureMask: false })).toEqual({
      mask: null,
      pixels: 2,
    });
    expect(calls).toEqual([0, 1]);
  });

  it('uses the emitter world-coordinate operand order at a strict equality boundary', () => {
    const values = Array.from({ length: 41 }, () => 1000);
    expect(
      rasterOutputRunLoss(
        group(values, {
          bounds: { minX: 0, minY: 0, maxX: 0.82, maxY: 1 },
          dotWidthCorrectionMm: 0.41,
        }),
        { shouldCaptureMask: true },
      )?.pixels,
    ).toBe(0);
    expect(
      rasterOutputRunLoss(
        group(values, {
          bounds: { minX: 0.1, minY: 0, maxX: 0.92, maxY: 1 },
          dotWidthCorrectionMm: 0.41,
        }),
        { shouldCaptureMask: true },
      ),
    ).toEqual({
      mask: { width: 41, height: 1, alpha: Uint8Array.from({ length: 41 }, () => 255) },
      pixels: 41,
    });
  });

  it('maps descending provider rows back to physical row indices', () => {
    const calls: number[] = [];
    const raster = group([], {
      sValues: new Uint16Array(0),
      pixelWidth: 1,
      pixelHeight: 2,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 2 },
      rowProviderOrder: 'descending-y',
      rowProvider: (y) => {
        calls.push(y);
        return Uint16Array.of(y === 0 ? 1000 : 0);
      },
    });
    expect(rasterOutputRunLoss(raster, { shouldCaptureMask: true })).toEqual({
      mask: { width: 1, height: 2, alpha: Uint8Array.of(0, 255) },
      pixels: 1,
    });
    expect(calls).toEqual([0, 1]);
  });

  it('keeps alternating grayscale runs linear at large row widths', () => {
    const width = 100_000;
    let numericReads = 0;
    const values = new Proxy(
      Uint16Array.from({ length: width }, (_, index) => (index % 2 === 0 ? 500 : 600)),
      {
        get(target, property) {
          if (typeof property === 'string' && Number.isInteger(Number(property))) numericReads += 1;
          return Reflect.get(target, property, target);
        },
      },
    );
    expect(
      rasterOutputRunLoss(
        group([], {
          sValues: new Uint16Array(0),
          pixelWidth: width,
          bounds: { minX: 0, minY: 0, maxX: width, maxY: 1 },
          dotWidthCorrectionMm: 0.1,
          rowProvider: () => values,
        }),
        { shouldCaptureMask: false },
      ),
    ).toEqual({
      mask: null,
      pixels: 0,
    });
    expect(numericReads).toBe(width);
  });
});
