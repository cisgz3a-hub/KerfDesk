import { describe, expect, it } from 'vitest';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const SIZE = 128;

function detailInk(x: number, y: number, length: number): boolean {
  const body = x >= 20 && x < 100 && y >= 45 && y < 80;
  const finger = x >= 24 && x < 100 && (x - 24) % 6 === 0 && y >= 45 - length && y < 45;
  return body || finger;
}

function thinDetails(length: number, inverted: boolean, turn: number, reflected: boolean) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  const expected = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const ink = Number(inverted ? !detailInk(x, y, length) : detailInk(x, y, length));
      let px = reflected ? SIZE - 1 - x : x;
      let py = y;
      for (let rotation = 0; rotation < turn; rotation += 1) [px, py] = [SIZE - 1 - py, px];
      const index = py * SIZE + px;
      expected[index] = ink;
      const value = ink === 1 ? 0 : 255;
      data.set([value, value, value, 255], index * 4);
    }
  }
  return { image: { width: SIZE, height: SIZE, data }, expected };
}

describe('Sharp narrow connected detail', () => {
  for (const inverted of [false, true]) {
    for (const length of [6, 10]) {
      it(`retains every ${length}px ${inverted ? 'paper channel' : 'ink stem'} under rotation and reflection`, async () => {
        for (const reflected of [false, true]) {
          for (let turn = 0; turn < 4; turn += 1) {
            const { image, expected } = thinDetails(length, inverted, turn, reflected);
            const paths = await traceImageToColoredPaths(image, TRACE_PRESETS.Sharp!);
            const loops = paths.flatMap((path) => path.polylines);
            expect(loops).toHaveLength(inverted ? 2 : 1);
            for (const loop of loops) {
              expect(loop.closed).toBe(true);
              expect(loop.points.at(-1)).toEqual(loop.points[0]);
            }
            const rendered = rasterizeColoredPaths(paths, SIZE, SIZE);
            const changed: number[] = [];
            for (let index = 0; index < expected.length; index += 1) {
              if (rendered.data[index] !== expected[index]) changed.push(index);
            }
            expect(changed, `turn ${turn}, reflected ${reflected}`).toEqual([]);
          }
        }
      });
    }
  }
});
