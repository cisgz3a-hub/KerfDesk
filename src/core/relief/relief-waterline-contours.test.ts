import { describe, expect, it } from 'vitest';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import { waterlineContours, type WaterlineContour } from './relief-waterline-contours';
import {
  ballKernel,
  coneMap,
  exactSurface,
  insideEdgeWall,
  plateauMap,
} from './relief-waterline.test-support';
import type { Heightmap } from './heightmap';

// ADR-423: waterline contours of the exact tip surface.

// The contours round the map's feature, not the wall at its edge (ADR-412
// Amendment 2).
function featureContours(
  map: Heightmap,
  contours: ReadonlyArray<WaterlineContour>,
): ReadonlyArray<WaterlineContour> {
  return contours.filter((contour) => contour.points.every((point) => insideEdgeWall(map, point)));
}

function signedArea(contour: WaterlineContour): number {
  let area = 0;
  contour.points.forEach((point, index) => {
    const next = contour.points[(index + 1) % contour.points.length] ?? point;
    area += point.x * next.y - next.x * point.y;
  });
  return area / 2;
}

function allSquares(cells: number): Uint8Array {
  return new Uint8Array(cells * cells).fill(1);
}

describe('waterlineContours (ADR-423)', () => {
  const kernel = ballKernel();

  it('places every vertex where the tip just clears the level, touching the wall', () => {
    const map = coneMap();
    const tip = dilateHeightmapByTool(map, kernel, 0);
    const surface = exactSurface(map, kernel);
    const contours = waterlineContours(map, tip, -3, allSquares(100), surface);
    const [loop, ...rest] = featureContours(map, contours);

    expect(rest).toEqual([]);
    expect(loop?.closed).toBe(true);
    // ADR-412 Amendment 2: the floor meets the stock past the map's edge in a
    // wall, and one more closed contour rides it within the ball's radius.
    const edge = contours.filter((contour) => contour !== loop);
    expect(edge).toHaveLength(1);
    expect(edge[0]?.closed).toBe(true);
    for (const point of edge[0]?.points ?? []) {
      expect(Math.min(point.x, 28 - point.x, point.y, 28 - point.y)).toBeLessThan(1.6);
    }
    for (const point of loop?.points ?? []) {
      expect(surface.clears(point.x, point.y, -3)).toBe(true);
      // One micrometre further toward the boss the ball would cut it.
      const toCenter = Math.hypot(14 - point.x, 14 - point.y);
      const inward = {
        x: point.x + (0.001 * (14 - point.x)) / toCenter,
        y: point.y + (0.001 * (14 - point.y)) / toCenter,
      };
      expect(surface.clears(inward.x, inward.y, -3)).toBe(false);
    }
  });

  it('keeps the wall on the right of travel', () => {
    const map = plateauMap();
    const tip = dilateHeightmapByTool(map, kernel, 0);
    const contours = waterlineContours(map, tip, -3, allSquares(100), exactSurface(map, kernel));
    const [loop] = featureContours(map, contours);
    const [edge] = contours.filter((contour) => contour !== loop);

    // Around a raised feature, wall on the right is clockwise in map numbers;
    // inside the wall at the map's edge it is anticlockwise.
    expect(signedArea(loop ?? { points: [], closed: true })).toBeLessThan(0);
    expect(signedArea(edge ?? { points: [], closed: true })).toBeGreaterThan(0);
  });

  it('rides the steep sampled wall at the ball-on-plane contact, level by level', () => {
    const map = plateauMap();
    const tip = dilateHeightmapByTool(map, kernel, 0);
    const surface = exactSurface(map, kernel);
    // The sampled wall face x = 9 is the facet from the last floor sample
    // (8.82, -6) to the first plateau sample (9.1, -1). A ball of radius r
    // resting on it with its centre at height zc sits where its distance to
    // the facet's line is r.
    const r = 3.175 / 2;
    const m = 5 / 0.28;
    const centreX = (z: number): number => 8.82 + (z + r + 6 - r * Math.hypot(1, m)) / m;
    for (const z of [-2.8, -4, -5.6]) {
      const [loop] = featureContours(map, waterlineContours(map, tip, z, allSquares(100), surface));
      const onFace = (loop?.points ?? []).filter((p) => p.y > 11 && p.y < 17 && p.x < 14);
      expect(onFace.length).toBeGreaterThan(0);
      for (const point of onFace) expect(point.x).toBeCloseTo(centreX(z), 3);
    }
  });

  it('opens the contour where the region ends', () => {
    const map = coneMap();
    const tip = dilateHeightmapByTool(map, kernel, 0);
    const region = new Uint8Array(100 * 100);
    for (let j = 0; j < 99; j += 1) for (let i = 0; i < 50; i += 1) region[j * 100 + i] = 1;
    const contours = featureContours(
      map,
      waterlineContours(map, tip, -3, region, exactSurface(map, kernel)),
    );

    expect(contours).toHaveLength(1);
    expect(contours[0]?.closed).toBe(false);
    for (const point of contours[0]?.points ?? []) expect(point.x).toBeLessThanOrEqual(50.5 * 0.28);
  });

  it('finds nothing above the highest tip or below the lowest', () => {
    const map = coneMap();
    const tip = dilateHeightmapByTool(map, kernel, 0);
    const surface = exactSurface(map, kernel);

    expect(waterlineContours(map, tip, 0, allSquares(100), surface)).toEqual([]);
    expect(waterlineContours(map, tip, -7, allSquares(100), surface)).toEqual([]);
  });
});
