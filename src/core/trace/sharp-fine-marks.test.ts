import { describe, expect, it } from 'vitest';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';
import { preprocessForTrace, type RawImageData } from './trace-image';

function fineMarks(reflected: boolean): RawImageData {
  const width = 64;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  const ink = (x: number, y: number): void => {
    data.set([0, 0, 0, 255], (y * width + (reflected ? width - 1 - x : x)) * 4);
  };
  // A thin diagonal is a coherent visual line, but every pixel is a separate
  // component under four-connectivity. Include short detached hatch marks too.
  for (let i = 0; i < 24; i += 1) ink(10 + i, 10 + i);
  for (let length = 1; length <= 3; length += 1) {
    for (let x = 0; x < length; x += 1) ink(10 + length * 10 + x, 45);
  }
  return { width, height: width, data };
}

describe('Sharp fine source marks', () => {
  it.each([false, true])(
    'retains diagonal and tiny hatch pixels, reflected=%s',
    async (reflected) => {
      const source = fineMarks(reflected);
      const options = TRACE_PRESETS.Sharp!;
      const mask = preprocessForTrace(source, options);
      expect(mask.data).toEqual(source.data);
      const paths = await traceImageToColoredPaths(source, options);
      const rendered = rasterizeColoredPaths(paths, source.width, source.height);
      for (let i = 0; i < source.width * source.height; i += 1) {
        expect(rendered.data[i], `pixel ${i % source.width},${Math.floor(i / source.width)}`).toBe(
          source.data[i * 4] === 0 ? 1 : 0,
        );
      }
    },
  );

  it('still lets the operator remove these marks explicitly', async () => {
    const source = fineMarks(false);
    const paths = await traceImageToColoredPaths(source, {
      ...TRACE_PRESETS.Sharp!,
      despeckleMinPixels: 4,
    });
    expect(paths).toEqual([]);
  });
});
