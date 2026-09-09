import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import type { RawImageData } from '../trace-image';
import { TRACE_PRESETS } from '../trace-presets';
import { traceImageToColoredPaths } from '../trace-to-paths';

type Fixture = 'Y' | 'ring';
type Transform = { readonly angle: number; readonly sx: number; readonly sy: number };
const TRANSFORMS: ReadonlyArray<Transform> = [
  { angle: 0, sx: 1, sy: 1 },
  { angle: Math.PI / 2, sx: 1, sy: 1 },
  { angle: 0, sx: -1, sy: 1 },
  { angle: 0, sx: 2, sy: 2 },
  { angle: 0, sx: 1.5, sy: 0.75 },
];

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function fixtureImage(fixture: Fixture, transform: Transform): RawImageData {
  const width = Math.ceil(128 * Math.abs(transform.sx));
  const height = Math.ceil(128 * Math.abs(transform.sy));
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const centre = { x: 64.5, y: 64.5 };
  const ends = [
    { x: 24.5, y: 22.5 },
    { x: 104.5, y: 22.5 },
    { x: 64.5, y: 109.5 },
  ];
  const cos = Math.cos(transform.angle);
  const sin = Math.sin(transform.angle);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - centre.x * Math.abs(transform.sx)) / transform.sx;
      const dy = (y + 0.5 - centre.y * Math.abs(transform.sy)) / transform.sy;
      const p = { x: centre.x + cos * dx + sin * dy, y: centre.y - sin * dx + cos * dy };
      const ink =
        fixture === 'Y'
          ? ends.some((end) => distanceToSegment(p, centre, end) <= 3)
          : Math.abs(Math.hypot(p.x - 58.5, p.y - 64.5) - 28) <= 3 ||
            distanceToSegment(p, { x: 86.5, y: 64.5 }, { x: 112.5, y: 64.5 }) <= 3;
      if (ink) {
        const index = (y * width + x) * 4;
        data[index] = data[index + 1] = data[index + 2] = 0;
      }
    }
  }
  return { width, height, data };
}

function segments(polyline: Polyline): Array<readonly [Vec2, Vec2]> {
  const result: Array<readonly [Vec2, Vec2]> = [];
  for (let i = 1; i < polyline.points.length; i += 1) {
    result.push([polyline.points[i - 1] as Vec2, polyline.points[i] as Vec2]);
  }
  if (polyline.closed && polyline.points.length > 1) {
    result.push([polyline.points.at(-1) as Vec2, polyline.points[0] as Vec2]);
  }
  return result;
}

function endpointGap(a: Polyline, b: Polyline): number {
  if (a.closed) return Infinity;
  let gap = Infinity;
  for (const point of [a.points[0] as Vec2, a.points.at(-1) as Vec2]) {
    for (const [r, s] of segments(b)) gap = Math.min(gap, distanceToSegment(point, r, s));
  }
  return gap;
}

describe('finished Centerline attachments', () => {
  for (const fixture of ['Y', 'ring'] as const) {
    for (const transform of TRANSFORMS) {
      // Enlarged/anisotropic raster rings can assemble as one open chain
      // returning to itself. Their exact-contact finisher contract is covered
      // independently in chain-attachments.test.ts without imposing a chain count.
      if (fixture === 'ring' && Math.abs(transform.sx) !== 1) continue;
      it(`keeps the ${fixture} attached at angle ${transform.angle}, scale ${transform.sx}/${transform.sy}`, async () => {
        const paths = await traceImageToColoredPaths(
          fixtureImage(fixture, transform),
          TRACE_PRESETS.Centerline!,
        );
        const polylines = paths.flatMap((path) => path.polylines);
        expect(polylines).toHaveLength(2);
        // A branch must END on the through-stroke/ring; crossing it after
        // accidentally extending the tip does not preserve the attachment.
        expect(
          Math.min(
            endpointGap(polylines[0]!, polylines[1]!),
            endpointGap(polylines[1]!, polylines[0]!),
          ),
        ).toBeLessThan(1e-8);
        // Attachment preservation must not discard the loop or a branch arm.
        expect(polylines.some((polyline) => polyline.closed)).toBe(fixture === 'ring');
        expect(polylines.every((polyline) => polyline.points.length >= 2)).toBe(true);
      });
    }
  }
});
