import { describe, expect, it } from 'vitest';
import { emitRasterGroup } from './emit-raster';

const SPARSE_ROW = [500, 0, 0, 0, 0, 0, 0, 500];

function emittedXAtY(gcode: string, targetY: number): number[] {
  const xValues: number[] = [];
  let modalY: number | undefined;
  for (const line of gcode.split('\n')) {
    if (!/^G[01]\b/.test(line)) continue;
    const yMatch = /\bY(-?\d+(?:\.\d+)?)/.exec(line);
    if (yMatch?.[1] !== undefined) modalY = Number(yMatch[1]);
    const xMatch = /\bX(-?\d+(?:\.\d+)?)/.exec(line);
    if (xMatch?.[1] !== undefined && modalY === targetY) xValues.push(Number(xMatch[1]));
  }
  return xValues;
}

function sparseRaster(rows: number): string {
  return emitRasterGroup({
    sValues: new Uint16Array(Array.from({ length: rows }, () => SPARSE_ROW).flat()),
    width: SPARSE_ROW.length,
    height: rows,
    bounds: { minX: 0, minY: 0, maxX: SPARSE_ROW.length, maxY: rows },
    feedMmPerMin: 1500,
    overscanMm: 5,
    bidirectional: true,
    controlledLaserOffTravelFeedMmPerMin: 800,
  });
}

describe('emitRasterGroup bounded split runways', () => {
  it('never reverses inside a wide blank gap on a forward row', () => {
    const xValues = emittedXAtY(sparseRaster(1), 0.5);

    expect(xValues).toEqual([-5, 0, 1, 1, 2, 7, 8, 13]);
    expect(xValues).toEqual([...xValues].sort((a, b) => a - b));
  });

  it('mirrors the monotonic bounded-gap path on a reverse row', () => {
    const xValues = emittedXAtY(sparseRaster(2), 1.5);

    expect(xValues).toEqual([13, 8, 7, 7, 6, 1, 0, -5]);
    expect(xValues).toEqual([...xValues].sort((a, b) => b - a));
  });
});
