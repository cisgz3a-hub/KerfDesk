import { describe, expect, it } from 'vitest';
import { emitRasterGroup, type EmitRasterInput } from './emit-raster';

const SERIAL_115200_8N1_BYTES_PER_SECOND = 11_520;

describe('raster serial-density evidence fixture', () => {
  it('quantifies narrow headroom at 0.05 mm and a wire-budget breach at 0.04 mm', () => {
    const interval005 = highEntropyRow(0.05);
    const compactBytesPerSecond = emittedBytesPerBurnSecond(emitRasterGroup(interval005));
    const repeated005BytesPerSecond = emittedBytesPerBurnSecond(
      emitRasterGroup({ ...interval005, modalFeedrate: false, emitSOnEveryBurnMove: true }),
    );
    const interval004 = highEntropyRow(0.04);
    const repeated004BytesPerSecond = emittedBytesPerBurnSecond(
      emitRasterGroup({ ...interval004, modalFeedrate: false, emitSOnEveryBurnMove: true }),
    );

    expect(compactBytesPerSecond).toBeLessThan(SERIAL_115200_8N1_BYTES_PER_SECOND);
    expect(repeated005BytesPerSecond).toBeGreaterThan(SERIAL_115200_8N1_BYTES_PER_SECOND * 0.9);
    expect(repeated005BytesPerSecond).toBeLessThan(SERIAL_115200_8N1_BYTES_PER_SECOND);
    expect(repeated004BytesPerSecond).toBeGreaterThan(SERIAL_115200_8N1_BYTES_PER_SECOND);
  });
});

function highEntropyRow(intervalMm: number): EmitRasterInput {
  const width = Math.round(25 / intervalMm);
  return {
    sValues: Uint16Array.from({ length: width }, (_, index) => (index % 2 === 0 ? 1000 : 0)),
    width,
    height: 1,
    bounds: { minX: 0, minY: 0, maxX: 25, maxY: 0.05 },
    feedMmPerMin: 1500,
    overscanMm: 0,
  };
}

function emittedBytesPerBurnSecond(gcode: string): number {
  // The fixture spans 25 mm at 1500 mm/min = one second of commanded burn motion.
  return new TextEncoder().encode(gcode).byteLength;
}
