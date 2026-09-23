import { describe, expect, it } from 'vitest';
import { coloredPathsToSvg } from './paths-to-svg';
import { traceImageToSvgString, type RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { runTraceSteps } from './trace-steps';
import { traceImageToColoredPaths } from './trace-to-paths';

const photo = TRACE_PRESETS['Photo shading']!;
const image: RawImageData = {
  width: 8,
  height: 8,
  data: Uint8ClampedArray.from({ length: 8 * 8 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 192)),
};

describe('photo tracing entry points', () => {
  it('preserves pale tones and canonical closed geometry on the application entry point', async () => {
    const paths = await traceImageToColoredPaths(image, photo);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.color).toBe('#000000');
    expect(paths[0]?.polylines.every((line) => line.closed)).toBe(true);
    expect(paths[0]?.curves?.length).toBe(paths[0]?.polylines.length);
  });

  it('awaits the cooperative fallback runner and matches the synchronous worker result', async () => {
    const native = await traceImageToColoredPaths(image, photo);
    const cooperative = await traceImageToColoredPaths(image, photo, async (steps) => {
      await Promise.resolve();
      return runTraceSteps(steps);
    });
    expect(cooperative).toEqual(native);
  });

  it('uses the same filled geometry through the legacy SVG entry point', async () => {
    const paths = await traceImageToColoredPaths(image, photo);
    expect(await traceImageToSvgString(image, photo)).toBe(coloredPathsToSvg(paths, 8, 8));
  });
});
