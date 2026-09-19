import { expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { rasterizeVectorToLuma } from './rasterize-vector';
import type { VectorFillGroup, VectorFillPath } from './rasterize-vector-fill';

const polygon = (points: ReadonlyArray<Vec2>): Polyline => ({ points, closed: true });
const box = (x: number, y: number, width: number, height: number): Polyline =>
  polygon([
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]);

it('matches independent angular winding for grouped fills, overlaps, holes and self-intersections', () => {
  const hole = box(2, 2, 2, 3);
  const groups: VectorFillGroup[] = [
    {
      objects: [
        {
          paths: [
            {
              fillRule: 'nonzero',
              polylines: [
                box(0, 0, 8, 9),
                box(5, 0, 6, 6),
                { ...hole, points: [...hole.points].reverse() },
              ],
            },
          ],
        },
        {
          paths: [
            {
              fillRule: 'evenodd',
              polylines: [
                polygon([
                  { x: 3, y: -1 },
                  { x: 12, y: 8 },
                  { x: 1, y: 8 },
                ]),
              ],
            },
          ],
        },
      ],
    },
    {
      objects: [
        {
          paths: [
            {
              fillRule: 'evenodd',
              polylines: [
                polygon([
                  { x: -1, y: 5 },
                  { x: 5, y: 11 },
                  { x: -1, y: 11 },
                  { x: 5, y: 5 },
                ]),
              ],
            },
            { fillRule: 'nonzero', polylines: [box(10, 2, 3, 7)] },
          ],
        },
      ],
    },
  ];
  const raster = rasterizeVectorToLuma({
    polylines: [],
    fillGroups: groups,
    bounds: { minX: -3, minY: -2, maxX: 17, maxY: 14 },
    dpi: 254,
  });
  let checked = 0;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const point = { x: -3 + (x + 0.5) / 10, y: -2 + (y + 0.5) / 10 };
      if (
        groups.some((group) =>
          group.objects.some((object) => object.paths.some((path) => touchesBoundary(point, path))),
        )
      )
        continue;
      const covered = groups.some(
        (group) =>
          group.objects.filter((object) => object.paths.some((path) => insidePath(point, path)))
            .length %
            2 ===
          1,
      );
      expect(raster.luma[y * raster.width + x], `pixel ${x},${y}`).toBe(covered ? 127 : 255);
      checked += 1;
    }
  }
  expect(checked).toBeGreaterThan(30_000);
});

// Sum signed turning angles around the query point. This oracle does not
// construct scanline crossings or use the production span sweep.
function insidePath(point: Vec2, path: VectorFillPath): boolean {
  let angle = 0;
  for (const contour of path.polylines) {
    for (let index = 0; index < contour.points.length; index += 1) {
      const a = contour.points[index]!,
        b = contour.points[(index + 1) % contour.points.length]!;
      const ax = a.x - point.x,
        ay = a.y - point.y,
        bx = b.x - point.x,
        by = b.y - point.y;
      angle += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    }
  }
  const winding = Math.round(angle / (2 * Math.PI));
  return path.fillRule === 'nonzero' ? winding !== 0 : winding % 2 !== 0;
}

function touchesBoundary(point: Vec2, path: VectorFillPath): boolean {
  return path.polylines.some((contour) =>
    contour.points.some((a, index) => {
      const b = contour.points[(index + 1) % contour.points.length]!;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        lengthSq = dx * dx + dy * dy;
      const projection =
        lengthSq === 0
          ? 0
          : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
      return Math.hypot(point.x - a.x - projection * dx, point.y - a.y - projection * dy) < 1e-8;
    }),
  );
}
