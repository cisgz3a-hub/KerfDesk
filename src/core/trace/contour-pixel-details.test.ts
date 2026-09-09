import { describe, expect, it } from 'vitest';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const SIZE = 128;

function detailInk(x: number, y: number, period: number): boolean {
  const body = x >= 20 && x < 100 && y >= 40 && y < 80;
  const tooth = y === 39 && x >= 20 && x < 100 && (x - 20) % period === 0;
  return body || tooth;
}

function detailImage(period: number, invert: boolean, turn: number, reflected: boolean) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4).fill(invert ? 0 : 255);
  const expected: Array<{ x: number; y: number; ink: number }> = [];
  const transform = (x: number, y: number) => {
    if (reflected) x = SIZE - 1 - x;
    for (let i = 0; i < turn; i += 1) [x, y] = [SIZE - 1 - y, x];
    return { x, y };
  };
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const ink = Number(invert ? !detailInk(x, y, period) : detailInk(x, y, period));
      const point = transform(x, y);
      const value = ink ? 0 : 255;
      data.set([value, value, value, 255], (point.y * SIZE + point.x) * 4);
      if (y === 39 && x >= 20 && x < 100) expected.push({ ...point, ink });
    }
  }
  return { image: { width: SIZE, height: SIZE, data }, expected };
}

describe('Sharp connected pixel details', () => {
  for (const inverted of [false, true]) {
    for (const period of [2, 3, 4, 6]) {
      it(`keeps every tooth and gap, period=${period}, paper=${inverted}`, async () => {
        for (const reflected of [false, true]) {
          for (let turn = 0; turn < 4; turn += 1) {
            const { image, expected } = detailImage(period, inverted, turn, reflected);
            const paths = await traceImageToColoredPaths(image, TRACE_PRESETS.Sharp!);
            const loops = paths.flatMap((path) => path.polylines);
            expect(loops).toHaveLength(inverted ? 2 : 1);
            for (const loop of loops) {
              expect(loop.closed).toBe(true);
              expect(loop.points.at(-1)).toEqual(loop.points[0]);
            }
            const rendered = rasterizeColoredPaths(paths, SIZE, SIZE);
            for (const { x, y, ink } of expected) {
              expect(rendered.data[y * SIZE + x], `pixel ${x},${y}; turn ${turn}`).toBe(ink);
            }
          }
        }
      });
    }
  }
});
