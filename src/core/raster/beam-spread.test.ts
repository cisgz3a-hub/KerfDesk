import { describe, expect, it } from 'vitest';
import { beamSpreadKernel, spreadRasterRows } from './beam-spread';

function spread(
  marks: ReadonlyArray<ReadonlyArray<number>>,
  diameter: number,
  subdivisions: number,
  sMax = 1,
): number[][] {
  const height = marks.length;
  const width = marks[0]?.length ?? 0;
  const kernel = beamSpreadKernel(diameter, diameter, subdivisions);
  if (kernel === null) throw new Error('expected a kernel');
  const out: number[][] = [];
  const order: number[] = [];
  spreadRasterRows(
    width,
    height,
    sMax,
    kernel,
    (y) => marks[y] ?? [],
    (y, row) => {
      order.push(y);
      out[y] = Array.from(row);
    },
  );
  expect(order).toEqual(Array.from({ length: height }, (_, y) => y));
  return out;
}

const grid = (width: number, height: number, mark: (x: number, y: number) => number) =>
  Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => mark(x, y)));

describe('beam spread (ADR-685)', () => {
  it('has no kernel for an unknown spot', () => {
    expect(beamSpreadKernel(0, 1)).toBeNull();
    expect(beamSpreadKernel(Number.NaN, 1)).toBeNull();
  });

  it('covers the area of the spot', () => {
    for (const subdivisions of [1, 2, 3]) {
      const kernel = beamSpreadKernel(1.6, 1.6, subdivisions);
      const area = (kernel?.shares.reduce((sum, share) => sum + share, 0) ?? 0) / subdivisions ** 2;
      expect(area).toBeCloseTo(Math.PI * 0.8 * 0.8, 1);
    }
  });

  it('keeps blank material blank and a solid field solid', () => {
    for (const subdivisions of [1, 3]) {
      expect(
        spread(
          grid(6, 5, () => 0),
          1.6,
          subdivisions,
        )
          .flat()
          .every((v) => v === 0),
      ).toBe(true);
      const solid = spread(
        grid(6, 5, () => 1),
        1.6,
        subdivisions,
      );
      for (const value of solid.flat()) expect(value).toBeCloseTo(1, 6);
    }
  });

  it('darkens the neighbours of a lone dot and keeps the scale of the marks', () => {
    const dot = spread(
      grid(5, 5, (x, y) => (x === 2 && y === 2 ? 255 : 0)),
      1.6,
      3,
      255,
    );
    expect(dot[2]?.[2]).toBeGreaterThan(200);
    expect(dot[2]?.[1]).toBeGreaterThan(0);
    expect(dot[1]?.[2]).toBeGreaterThan(0);
    expect(dot[0]?.[0]).toBe(0);
    const total = dot.flat().reduce((sum, v) => sum + v, 0) / 255;
    expect(total).toBeCloseTo(Math.PI * 0.8 * 0.8, 1);
  });

  it('burns a 50% checkerboard darker than half, as overlapping spots do', () => {
    const checker = spread(
      grid(12, 12, (x, y) => ((x + y) % 2 === 0 ? 1 : 0)),
      1.6,
      3,
    );
    const inner = checker.slice(2, 10).flatMap((row) => row.slice(2, 10));
    const mean = inner.reduce((sum, v) => sum + v, 0) / inner.length;
    expect(mean).toBeGreaterThan(0.75);
    expect(mean).toBeLessThan(1);
  });

  it('leaves the corners of a cell unburned when the spot is no wider than the cell', () => {
    const solid = spread(
      grid(4, 3, () => 1),
      1,
      3,
    );
    expect(solid[1]?.[1]).toBeCloseTo(Math.PI / 4, 1);
  });

  it('spreads a Grayscale mark in proportion to its power', () => {
    const half = spread(
      grid(5, 5, (x, y) => (x === 2 && y === 2 ? 0.5 : 0)),
      1.6,
      3,
    );
    const full = spread(
      grid(5, 5, (x, y) => (x === 2 && y === 2 ? 1 : 0)),
      1.6,
      3,
    );
    expect(half[2]?.[1] ?? 0).toBeCloseTo((full[2]?.[1] ?? 0) / 2, 6);
  });
});
