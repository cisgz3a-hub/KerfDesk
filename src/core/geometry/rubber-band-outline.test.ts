import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type RasterImage,
  type Transform,
} from '../scene';
import { convexHull } from './convex-hull';
import { pointInPolygon } from './point-in-polygon';
import { RUBBER_BAND_OUTLINE_SOURCE, rubberBandOutline } from './rubber-band-outline';

describe('convex hull', () => {
  it('drops interior, repeated and collinear points', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 0, y: 0 },
    ]);

    expect(hull).toHaveLength(4);
    expect(hull).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    );
  });
});

describe('rubber-band outline', () => {
  it('stretches one closed outline around every selected object', () => {
    const outline = rubberBandOutline([square('a', 0, 0, 10), square('b', 20, 5, 10)], 'outline');

    expect(outline).toMatchObject({
      kind: 'imported-svg',
      id: 'outline',
      source: RUBBER_BAND_OUTLINE_SOURCE,
      transform: IDENTITY_TRANSFORM,
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 15 },
    });
    const ring = onlyPolyline(outline);
    expect(ring.closed).toBe(true);
    // The two inner corners that face each other are cut off by the band; the
    // first point repeats at the end so every side is drawn.
    expect(ring.points).toHaveLength(7);
    expect(ring.points.at(-1)).toEqual(ring.points[0]);
    expect(ring.points).not.toContainEqual({ x: 10, y: 10 });
    expect(ring.points).not.toContainEqual({ x: 20, y: 5 });
  });

  it('uses artwork outlines in world space, including rotation and scale', () => {
    const turned = square('turned', 0, 0, 10, {
      ...IDENTITY_TRANSFORM,
      x: 50,
      y: 50,
      scaleX: 2,
      rotationDeg: 90,
    });

    const outline = rubberBandOutline([turned], 'outline');

    // 20 × 10 after scaling, then turned a quarter: 10 wide, 20 tall.
    expect(outline?.bounds.minX).toBeCloseTo(40);
    expect(outline?.bounds.maxX).toBeCloseTo(50);
    expect(outline?.bounds.minY).toBeCloseTo(50);
    expect(outline?.bounds.maxY).toBeCloseTo(70);
  });

  it('wraps an image by its four transformed corners', () => {
    const image = raster({ ...IDENTITY_TRANSFORM, x: 100, y: 100, rotationDeg: 45 });

    const ring = onlyPolyline(rubberBandOutline([image], 'outline'));

    expect(ring.points).toHaveLength(5);
    const half = Math.SQRT1_2 * 10;
    expect(
      ring.points
        .slice(0, -1)
        .map((point) => point.x)
        .sort((a, b) => a - b),
    ).toEqual([
      expect.closeTo(100 - half),
      expect.closeTo(100),
      expect.closeTo(100),
      expect.closeTo(100 + half),
    ]);
  });

  it('keeps every source point inside or on the outline', () => {
    const objects = [square('a', 0, 0, 10), square('b', 30, 40, 5), square('c', -20, 25, 8)];
    const ring = onlyPolyline(rubberBandOutline(objects, 'outline'));
    const grown = ring.points.map((point) => ({ x: point.x * 1.0001, y: point.y * 1.0001 }));

    for (const object of objects) {
      for (const point of object.paths[0]?.polylines[0]?.points ?? []) {
        const onHull = ring.points.some((hull) => hull.x === point.x && hull.y === point.y);
        expect(onHull || pointInPolygon(point, grown)).toBe(true);
      }
    }
  });

  it('refuses a selection with no area', () => {
    const line: ImportedSvg = {
      ...square('line', 0, 0, 10),
      paths: [{ color: '#000000', polylines: [{ closed: false, points: [p(0, 0), p(10, 0)] }] }],
    };
    const lineAndPoint: ImportedSvg = {
      ...line,
      id: 'second',
      paths: [{ color: '#000000', polylines: [{ closed: false, points: [p(20, 0), p(30, 0)] }] }],
    };

    expect(rubberBandOutline([line], 'outline')).toBeNull();
    expect(rubberBandOutline([line, lineAndPoint], 'outline')).toBeNull();
    expect(rubberBandOutline([], 'outline')).toBeNull();
  });
});

function p(x: number, y: number): { readonly x: number; readonly y: number } {
  return { x, y };
}

function square(
  id: string,
  x: number,
  y: number,
  size: number,
  transform: Transform = IDENTITY_TRANSFORM,
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
    transform,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [p(x, y), p(x + size, y), p(x + size, y + size), p(x, y + size)],
          },
        ],
      },
    ],
  };
}

function raster(transform: Transform): RasterImage {
  return {
    kind: 'raster-image',
    id: 'image',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
  };
}

function onlyPolyline(outline: ImportedSvg | null): Polyline {
  const polyline = outline?.paths[0]?.polylines[0];
  if (outline?.paths.length !== 1 || polyline === undefined) throw new Error('no outline');
  return polyline;
}
