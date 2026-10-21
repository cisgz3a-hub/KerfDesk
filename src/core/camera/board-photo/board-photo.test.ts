import { describe, expect, it } from 'vitest';
import { applyHomography } from '../homography';
import { orderQuadCorners, orientReference, photoToMm } from './photo-quad';
import { rectifiedRegion } from './rectify-photo';
import { straightDownToMm } from './trace-board';

describe('board photo geometry', () => {
  it('orders shuffled corners as TL, TR, BR, BL', () => {
    const ordered = orderQuadCorners([
      { x: 210, y: 170 },
      { x: 20, y: 30 },
      { x: 30, y: 180 },
      { x: 200, y: 20 },
    ]);
    expect(ordered).toEqual([
      { x: 20, y: 30 },
      { x: 200, y: 20 },
      { x: 210, y: 170 },
      { x: 30, y: 180 },
    ]);
  });

  it.each([
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 100 },
    ],
    [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ],
  ])('rejects concave or tiny quads', (...points) => {
    expect(orderQuadCorners(points)).toBeNull();
  });

  it('orients the reference long side with the photographed long side', () => {
    const quad = orderQuadCorners([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(quad).not.toBeNull();
    if (quad !== null)
      expect(orientReference(quad, 210, 297)).toEqual({ widthMm: 297, heightMm: 210 });
  });

  it('maps the reference quad to millimetres and sizes a rectified region', () => {
    const quad = orderQuadCorners([
      { x: 40, y: 30 },
      { x: 330, y: 50 },
      { x: 310, y: 260 },
      { x: 20, y: 240 },
    ]);
    expect(quad).not.toBeNull();
    if (quad === null) return;
    const matrix = photoToMm(quad, { widthMm: 210, heightMm: 297 });
    expect(matrix).not.toBeNull();
    if (matrix === null) return;
    const corners = quad.map((point) => applyHomography(matrix, point));
    expect(corners[0]).toEqual(
      expect.objectContaining({ x: expect.closeTo(0), y: expect.closeTo(0) }),
    );
    expect(corners[2]?.x).toBeCloseTo(210);
    expect(corners[2]?.y).toBeCloseTo(297);
    const info = rectifiedRegion(400, 300, matrix, { widthMm: 210, heightMm: 297 });
    expect(info.region.width).toBeGreaterThan(210);
    expect(info.pixelsPerMm).toBeLessThanOrEqual(4);
  });

  it('provides a stable rough straight-down scale', () => {
    expect(straightDownToMm(800, 400)).toEqual([0.5, 0, 0, 0, 0.5, 0, 0, 0, 1]);
  });
});
