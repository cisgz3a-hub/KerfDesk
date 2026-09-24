import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type RasterImage, type Vec2 } from '../scene';
import { convexHull } from './convex-hull';
import { rubberBandOutline } from './rubber-band-outline';

function pathObject(id: string, points: ReadonlyArray<Vec2>, closed = true): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ closed, points: [...points] }] }],
  };
}

describe('convexHull', () => {
  it('wraps the outer points counter-clockwise and drops inner and edge points', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 3, y: 4 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);

    expect(hull).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it('returns a degenerate hull for points on one line', () => {
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);
  });
});

describe('rubberBandOutline (ADR-377)', () => {
  it('stretches one closed outline around separate shapes, skipping points inside it', () => {
    const triangle = pathObject('triangle', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ]);
    const dot = pathObject(
      'far',
      [
        { x: 30, y: 2 },
        { x: 31, y: 2 },
      ],
      false,
    );

    const result = rubberBandOutline([triangle, dot], 'outline', '#2563eb');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.transform).toEqual(IDENTITY_TRANSFORM);
    expect(result.value.paths).toEqual([
      {
        color: '#2563eb',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 31, y: 2 },
              { x: 5, y: 8 },
            ],
          },
        ],
      },
    ]);
    expect(result.value.bounds).toEqual({ minX: 0, minY: 0, maxX: 31, maxY: 8 });
  });

  it('uses the placed corners of an image, including its rotation', () => {
    const image = {
      kind: 'raster-image',
      id: 'photo',
      source: 'photo.png',
      pixelWidth: 10,
      pixelHeight: 10,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50, rotationDeg: 45 },
      color: '#333333',
      dither: 'floyd-steinberg',
      linesPerMm: 10,
    } as unknown as RasterImage;

    const result = rubberBandOutline([image], 'outline', '#000000');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const points = result.value.paths[0]?.polylines[0]?.points ?? [];
    expect(points).toHaveLength(4);
    // A 10 mm square turned 45 degrees spans its diagonal, about 14.14 mm.
    expect(result.value.bounds.maxX - result.value.bounds.minX).toBeCloseTo(Math.SQRT2 * 10, 6);
  });

  it('follows the transformed geometry of vector artwork', () => {
    const scaled: ImportedSvg = {
      ...pathObject('scaled', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
      transform: { ...IDENTITY_TRANSFORM, x: 100, scaleX: 2 },
    };

    const result = rubberBandOutline([scaled], 'outline', '#000000');

    expect(result.kind === 'ok' ? result.value.bounds : null).toEqual({
      minX: 100,
      minY: 0,
      maxX: 120,
      maxY: 10,
    });
  });

  it('refuses a selection with no area and an empty selection', () => {
    const line = pathObject(
      'line',
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      false,
    );

    const flat = rubberBandOutline([line], 'outline', '#000000');
    const empty = rubberBandOutline([], 'outline', '#000000');

    expect(flat.kind === 'error' ? flat.error.kind : null).toBe('empty-result');
    expect(empty.kind === 'error' ? empty.error.kind : null).toBe('too-few-objects');
  });
});
