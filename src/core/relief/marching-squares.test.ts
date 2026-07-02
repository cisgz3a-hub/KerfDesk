import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { marchingSquares } from './marching-squares';

function maskOf(rows: ReadonlyArray<string>): { mask: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const mask = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x += 1) {
      mask[y * w + x] = row[x] === '#' ? 1 : 0;
    }
  });
  return { mask, w, h };
}

describe('marchingSquares', () => {
  it('a solid block yields one closed loop', () => {
    const { mask, w, h } = maskOf(['....', '.##.', '.##.', '....']);
    const loops = marchingSquares(mask, w, h);
    expect(loops).toHaveLength(1);
    expect(loops[0]?.closed).toBe(true);
    // Loop closes: first point equals last point.
    const points = loops[0]?.points ?? [];
    expect(points[0]).toEqual(points[points.length - 1]);
  });

  it('a donut yields two loops (outer boundary + hole)', () => {
    const { mask, w, h } = maskOf(['#####', '#...#', '#...#', '#####']);
    const loops = marchingSquares(mask, w, h);
    expect(loops).toHaveLength(2);
    expect(loops.every((loop) => loop.closed)).toBe(true);
  });

  it('two separate blobs yield two loops', () => {
    const { mask, w, h } = maskOf(['##..##', '##..##']);
    const loops = marchingSquares(mask, w, h);
    expect(loops).toHaveLength(2);
  });

  it('an empty mask yields nothing; a full mask yields one border loop', () => {
    const empty = maskOf(['....', '....']);
    expect(marchingSquares(empty.mask, empty.w, empty.h)).toHaveLength(0);
    const full = maskOf(['####', '####']);
    expect(marchingSquares(full.mask, full.w, full.h)).toHaveLength(1);
  });

  it('property: every loop closes and output is deterministic (100 seeds)', () => {
    const grid = fc
      .record({
        w: fc.integer({ min: 2, max: 12 }),
        h: fc.integer({ min: 2, max: 12 }),
        bits: fc.array(fc.boolean(), { minLength: 144, maxLength: 144 }),
      })
      .map(({ w, h, bits }) => {
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i += 1) mask[i] = bits[i] === true ? 1 : 0;
        return { mask, w, h };
      });
    fc.assert(
      fc.property(grid, ({ mask, w, h }) => {
        const a = marchingSquares(mask, w, h);
        const b = marchingSquares(mask, w, h);
        expect(a).toEqual(b);
        for (const loop of a) {
          expect(loop.closed).toBe(true);
          expect(loop.points.length).toBeGreaterThanOrEqual(4);
          expect(loop.points[0]).toEqual(loop.points[loop.points.length - 1]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
