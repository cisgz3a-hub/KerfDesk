import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { curveLut } from './curves';

describe('curveLut', () => {
  it('the two-point diagonal is the identity', () => {
    const lut = curveLut([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]);
    for (const i of [0, 1, 64, 128, 200, 255]) expect(lut[i]).toBe(i);
  });

  it('extends flat beyond the outermost points', () => {
    const lut = curveLut([
      { x: 100, y: 50 },
      { x: 200, y: 220 },
    ]);
    expect(lut[0]).toBe(50);
    expect(lut[99]).toBe(50);
    expect(lut[201]).toBe(220);
    expect(lut[255]).toBe(220);
  });

  it('an s-curve darkens shadows and lightens highlights', () => {
    const lut = curveLut([
      { x: 0, y: 0 },
      { x: 64, y: 40 },
      { x: 192, y: 215 },
      { x: 255, y: 255 },
    ]);
    expect(lut[64]).toBe(40);
    expect(lut[192]).toBe(215);
    expect(lut[32] ?? 0).toBeLessThan(32);
    expect(lut[224] ?? 0).toBeGreaterThan(224);
  });

  it('never overshoots: monotone control points give a monotone LUT', () => {
    fc.assert(
      fc.property(
        fc
          .array(
            fc.record({ x: fc.integer({ min: 0, max: 255 }), y: fc.integer({ min: 0, max: 255 }) }),
            {
              minLength: 2,
              maxLength: 8,
            },
          )
          .map((points) =>
            [...points]
              .sort((a, b) => a.x - b.x)
              .map((p, i, all) => ({
                x: p.x,
                // Force monotone-increasing y so the property is well-posed.
                y: all.slice(0, i + 1).reduce((acc, q) => Math.max(acc, q.y), 0),
              })),
          ),
        (points) => {
          const lut = curveLut(points);
          for (let i = 1; i < 256; i += 1) {
            if ((lut[i] ?? 0) < (lut[i - 1] ?? 0)) return false;
          }
          return true;
        },
      ),
    );
  });

  it('handles degenerate inputs: empty is identity, one point is flat', () => {
    expect(curveLut([])[77]).toBe(77);
    expect(curveLut([{ x: 10, y: 99 }])[0]).toBe(99);
    expect(curveLut([{ x: 10, y: 99 }])[255]).toBe(99);
  });

  it('a repeated x keeps the last y', () => {
    const lut = curveLut([
      { x: 0, y: 0 },
      { x: 128, y: 10 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ]);
    expect(lut[128]).toBe(200);
  });
});
