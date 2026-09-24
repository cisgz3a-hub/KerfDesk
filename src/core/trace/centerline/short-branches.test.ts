import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import type { RawImageData } from '../trace-image';
import { TRACE_PRESETS } from '../trace-presets';
import { traceImageToColoredPaths } from '../trace-to-paths';
import { traceScalePlan } from '../trace-upscale-policy';

const CENTERLINE = TRACE_PRESETS.Centerline!;

function inkRect(image: RawImageData, x: number, y: number, width: number, height: number): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = (row * image.width + column) * 4;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 0;
    }
  }
}

function branchImage(thickness: number, length: number, broadContext: boolean): RawImageData {
  const image = {
    width: 192,
    height: 192,
    data: new Uint8ClampedArray(192 * 192 * 4).fill(255),
  };
  inkRect(image, 35, 120, 120, thickness);
  inkRect(image, 95, 120 - length, thickness, length);
  if (broadContext) inkRect(image, 20, 15, 150, 45);
  return image;
}

function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const squareLength = dx * dx + dy * dy;
  const t =
    squareLength === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squareLength));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function pathDistance(point: Vec2, path: Polyline): number {
  let result = Infinity;
  for (let i = 1; i < path.points.length; i += 1) {
    result = Math.min(result, segmentDistance(point, path.points[i - 1]!, path.points[i]!));
  }
  return result;
}

function endpointGap(a: Polyline, b: Polyline): number {
  return Math.min(pathDistance(a.points[0]!, b), pathDistance(a.points.at(-1)!, b));
}

function rotate(point: Vec2, turns: number): Vec2 {
  for (let i = 0; i < turns; i += 1) point = { x: 192 - point.y, y: point.x };
  return point;
}

async function lowerPaths(image: RawImageData, turns: number): Promise<Polyline[]> {
  const rotated = { ...image, data: new Uint8ClampedArray(image.data.length) };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const point = rotate({ x: x + 0.5, y: y + 0.5 }, turns);
      rotated.data.set(
        image.data.subarray((y * 192 + x) * 4, (y * 192 + x) * 4 + 4),
        (Math.floor(point.y) * 192 + Math.floor(point.x)) * 4,
      );
    }
  }
  const result = await traceImageToColoredPaths(rotated, CENTERLINE);
  return result
    .flatMap((path) => path.polylines)
    .map((path) => ({
      ...path,
      points: path.points.map((point) => rotate(point, (4 - turns) % 4)),
    }))
    .filter((path) => path.points.every((point) => point.y > 90));
}

describe('short Centerline branches', () => {
  it.each(
    [
      { thickness: 1, length: 2 },
      { thickness: 1, length: 3 },
      { thickness: 2, length: 2 },
      { thickness: 2, length: 3 },
    ].flatMap((fixture) =>
      [0, 1, 2, 3].map((turns) => ({
        ...fixture,
        turns,
      })),
    ),
  )(
    'retains a $thickness-pixel-wide, $length-pixel branch at rotation $turns across an unrelated scale change',
    async ({ thickness, length, turns }) => {
      for (const broadContext of [false, true]) {
        const image = branchImage(thickness, length, broadContext);
        expect(traceScalePlan(image, CENTERLINE)).toEqual(
          broadContext ? { kind: 'native' } : { kind: 'upscale', factor: 2 },
        );
        const lower = await lowerPaths(image, turns);
        expect(lower, `broad context: ${broadContext}`).toHaveLength(2);
        const tip = { x: 95 + thickness / 2, y: 120 - length + 0.5 };
        expect(Math.min(...lower.map((path) => pathDistance(tip, path)))).toBeLessThan(0.8);
        // Keeping the tiny arm is not enough: it must finish on the trunk.
        expect(
          Math.min(endpointGap(lower[0]!, lower[1]!), endpointGap(lower[1]!, lower[0]!)),
        ).toBeLessThan(1e-8);
      }
    },
  );

  it.each([1, 2, 3])('keeps a %s-pixel-wide L corner free of branches', async (thickness) => {
    const image = branchImage(thickness, 25, true);
    // Erase the arm left of the junction, leaving an L with a drawn corner.
    for (let y = 120; y < 120 + thickness; y += 1) {
      image.data.fill(255, (y * 192 + 35) * 4, (y * 192 + 95) * 4);
    }
    for (const turns of [0, 1, 2, 3]) expect(await lowerPaths(image, turns)).toHaveLength(1);
  });

  it('does not turn a lone extra source pixel into a branch', async () => {
    for (const broadContext of [false, true]) {
      const image = branchImage(1, 1, broadContext);
      for (const turns of [0, 1, 2, 3]) expect(await lowerPaths(image, turns)).toHaveLength(1);
    }
  });
});
