import { describe, expect, it } from 'vitest';
import { boardFitRegion } from './board-fit-region';
import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ShapeObject,
  type ShapeSpec,
  type Transform,
} from './scene-object';

function box(
  spec: ShapeSpec,
  bounds: Bounds,
  transform: Transform = IDENTITY_TRANSFORM,
): ShapeObject {
  return { kind: 'shape', id: 'B', spec, color: '#ff00aa', bounds, transform, paths: [] };
}

describe('boardFitRegion', () => {
  it('returns the full scene bounds for a rectangle board', () => {
    const region = boardFitRegion(
      box(
        { kind: 'rect', widthMm: 100, heightMm: 60, cornerRadiusMm: 0 },
        {
          minX: 0,
          minY: 0,
          maxX: 100,
          maxY: 60,
        },
      ),
    );
    expect(region).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 60 });
  });

  it('returns the centered inscribed square for a circle board (art stays inside the arc)', () => {
    // diameter 100 -> inscribed square side 100/√2 ≈ 70.71, centred at (50, 50).
    const region = boardFitRegion(
      box(
        { kind: 'ellipse', widthMm: 100, heightMm: 100 },
        { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      ),
    );
    const side = 100 / Math.SQRT2;
    expect((region.minX + region.maxX) / 2).toBeCloseTo(50);
    expect((region.minY + region.maxY) / 2).toBeCloseTo(50);
    expect(region.maxX - region.minX).toBeCloseTo(side);
    expect(region.maxX - region.minX).toBeLessThan(100); // smaller than the bbox square
  });

  it('honours the box position + scale (scene space)', () => {
    // local 0..45, scaled 2x, offset (20,30) -> scene bbox 20..110 (90 wide).
    const scaled: Transform = { ...IDENTITY_TRANSFORM, x: 20, y: 30, scaleX: 2, scaleY: 2 };
    const region = boardFitRegion(
      box(
        { kind: 'ellipse', widthMm: 45, heightMm: 45 },
        { minX: 0, minY: 0, maxX: 45, maxY: 45 },
        scaled,
      ),
    );
    expect((region.minX + region.maxX) / 2).toBeCloseTo(65);
    expect((region.minY + region.maxY) / 2).toBeCloseTo(75);
    expect(region.maxX - region.minX).toBeCloseTo(90 / Math.SQRT2);
  });
});
