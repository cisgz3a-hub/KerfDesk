import { describe, expect, it } from 'vitest';
import {
  contourCrossings,
  contourGap,
  contourTopologyImage,
} from '../../__fixtures__/contour-topology';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

describe('contour finishing topology', () => {
  for (const preset of ['Line Art', 'Smooth', 'Sharp', 'Edge Detection']) {
    for (const kind of ['notch', 'separate'] as const) {
      it.each([
        { name: 'zero', smoothness: 0, optimize: 0 },
        { name: 'default' },
        { name: 'maximum', smoothness: 1.33, optimize: 2 },
      ])(
        `${preset} ${kind} $name keeps continuous boundaries separate`,
        async ({ name: _name, ...settings }) => {
          const paths = await traceImageToColoredPaths(contourTopologyImage(kind), {
            ...TRACE_PRESETS[preset]!,
            ...settings,
            ignoreLessThanPixels: 0,
            supersampleContour: false,
            autoUpscaleSmallSources: false,
            upscaleSmallSmoothSources: false,
          });
          const polylines = paths.flatMap((path) => path.polylines);
          expect(polylines).toHaveLength(kind === 'notch' ? 1 : 2);
          expect(contourCrossings(polylines)).toBe(0);
          for (const polyline of polylines) {
            expect(polyline.closed).toBe(true);
            expect(polyline.points.at(-1)).toEqual(polyline.points[0]);
            expect(polyline.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
              true,
            );
          }
          if (kind === 'separate')
            expect(contourGap(polylines[0]!, polylines[1]!)).toBeGreaterThan(0);
        },
      );
    }
  }

  it('retains the valid subpixel Line Art default gap', async () => {
    const paths = await traceImageToColoredPaths(contourTopologyImage('separate'), {
      ...TRACE_PRESETS['Line Art']!,
      ignoreLessThanPixels: 0,
    });
    const [a, b] = paths.flatMap((path) => path.polylines);
    expect(contourGap(a!, b!)).toBe(0.11049530850844717);
  });
});
