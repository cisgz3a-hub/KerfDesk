import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import { downscaleTracedPaths, upscaleBy } from '../auto-upscale';
import { TRACE_PRESETS } from '../trace-presets';
import { traceCenterlineStrokePaths } from './trace-centerline';

function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function pathDistance(point: Vec2, path: Polyline): number {
  let result = Infinity;
  for (let i = 1; i < path.points.length; i += 1) {
    result = Math.min(result, segmentDistance(point, path.points[i - 1]!, path.points[i]!));
  }
  return result;
}

function branchImage(thickness: number, degrees: number) {
  const angle = (degrees * Math.PI) / 180;
  const rotate = (point: Vec2): Vec2 => ({
    x: 96 + (point.x - 96) * Math.cos(angle) - (point.y - 132) * Math.sin(angle),
    y: 132 + (point.x - 96) * Math.sin(angle) + (point.y - 132) * Math.cos(angle),
  });
  const a = rotate({ x: 40, y: 132 });
  const b = rotate({ x: 152, y: 132 });
  const base = { x: 96, y: 132 };
  const tip = rotate({ x: 96, y: 129 });
  const image = { width: 192, height: 192, data: new Uint8ClampedArray(192 * 192 * 4).fill(255) };
  // Independent analytic capsules with 4x4 pixel-area coverage. No tracer
  // preprocessing or skeleton routine participates in generating the ink.
  for (let y = 70; y < 190; y += 1)
    for (let x = 1; x < 191; x += 1) {
      let ink = 0;
      for (let v = 0; v < 4; v += 1)
        for (let u = 0; u < 4; u += 1) {
          const point = { x: x + (u + 0.5) / 4, y: y + (v + 0.5) / 4 };
          if (
            Math.min(segmentDistance(point, a, b), segmentDistance(point, base, tip)) <=
            thickness / 2
          )
            ink += 1;
        }
      const luma = Math.round(255 * (1 - ink / 16));
      image.data.set([luma, luma, luma, 255], (y * 192 + x) * 4);
    }
  return { image, tip };
}

describe('full-width antialiased Centerline branches', () => {
  it.each(
    [1, 2].flatMap((thickness) =>
      [45, 135].flatMap((degrees) => [1, 2].map((factor) => ({ thickness, degrees, factor }))),
    ),
  )(
    'keeps a $thickness px cap at $degrees degrees and $factor× working scale',
    ({ thickness, degrees, factor }) => {
      const { image, tip } = branchImage(thickness, degrees);
      const result = downscaleTracedPaths(
        traceCenterlineStrokePaths(upscaleBy(image, factor), {
          ...TRACE_PRESETS.Centerline!,
          pixelScale: factor,
        }),
        factor,
      );
      const paths = result.flatMap((path) => path.polylines);
      expect(paths).toHaveLength(2);
      expect(Math.min(...paths.map((path) => pathDistance(tip, path)))).toBeLessThan(1);
      const [a, b] = paths as [Polyline, Polyline];
      expect(
        Math.min(
          pathDistance(a.points[0]!, b),
          pathDistance(a.points.at(-1)!, b),
          pathDistance(b.points[0]!, a),
          pathDistance(b.points.at(-1)!, a),
        ),
      ).toBeLessThan(1e-8);
    },
  );
});
