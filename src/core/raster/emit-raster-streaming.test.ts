import { describe, expect, it } from 'vitest';
import { emitRasterGroup, emitRasterGroupChunks, type EmitRasterInput } from './emit-raster';

describe('emitRasterGroup row streaming', () => {
  it('emits byte-identical chunks from a row provider without a full raster buffer', () => {
    const materialized: EmitRasterInput = {
      sValues: new Uint16Array([100, 0, 0, 100]),
      width: 2,
      height: 2,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      feedMmPerMin: 6000,
      overscanMm: 0,
    };
    const streamed: EmitRasterInput = {
      ...materialized,
      sValues: new Uint16Array(0),
      rowProvider: (y) => (y === 0 ? new Uint16Array([100, 0]) : new Uint16Array([0, 100])),
    };

    expect([...emitRasterGroupChunks(streamed)].join('')).toBe(emitRasterGroup(materialized));
    expect(emitRasterGroup(streamed)).toBe(emitRasterGroup(materialized));
  });
});
