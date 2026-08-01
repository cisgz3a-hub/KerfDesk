import { describe, expect, it, vi } from 'vitest';
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

  it('consumes a descending-Y provider once in forward source order', () => {
    const rows = [
      new Uint16Array([100, 0]),
      new Uint16Array([0, 100]),
      new Uint16Array([100, 100]),
    ];
    const rowProvider = vi.fn((row: number) => rows[row] ?? new Uint16Array(0));

    const gcode = emitRasterGroup({
      sValues: new Uint16Array(0),
      rowProvider,
      rowProviderOrder: 'descending-y',
      width: 2,
      height: 3,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 3 },
      feedMmPerMin: 6000,
      overscanMm: 0,
    });

    expect(rowProvider.mock.calls.map(([row]) => row)).toEqual([0, 1, 2]);
    expect([...gcode.matchAll(/G0 X[^\n]+ Y([^ ]+)/g)].map((match) => Number(match[1]))).toEqual([
      2.5, 1.5, 0.5,
    ]);
  });

  it('emits identical descending-Y G-code from materialized and streamed rows', () => {
    const rows = [
      new Uint16Array([100, 0]),
      new Uint16Array([0, 100]),
      new Uint16Array([100, 100]),
    ];
    const materialized: EmitRasterInput = {
      sValues: Uint16Array.from(rows.flatMap((row) => [...row])),
      rowProviderOrder: 'descending-y',
      width: 2,
      height: 3,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 3 },
      feedMmPerMin: 6000,
      overscanMm: 0,
    };
    const streamed: EmitRasterInput = {
      ...materialized,
      sValues: new Uint16Array(0),
      rowProvider: (row) => rows[row] ?? new Uint16Array(0),
    };

    expect(emitRasterGroup(materialized)).toBe(emitRasterGroup(streamed));
  });
});
