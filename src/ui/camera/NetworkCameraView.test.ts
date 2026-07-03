import { describe, expect, it } from 'vitest';
import { clickToIntrinsicPixel } from './NetworkCameraView';

describe('clickToIntrinsicPixel', () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 };
  const natural = { width: 1280, height: 960 };

  it('maps a centre click to the intrinsic centre', () => {
    const point = clickToIntrinsicPixel(300, 200, rect, natural);
    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(640, 6);
    expect(point!.y).toBeCloseTo(480, 6);
  });

  it('maps the top-left corner to (0, 0)', () => {
    expect(clickToIntrinsicPixel(100, 50, rect, natural)).toEqual({ x: 0, y: 0 });
  });

  it('maps the bottom-right corner to the intrinsic size', () => {
    const point = clickToIntrinsicPixel(500, 350, rect, natural);
    expect(point!.x).toBeCloseTo(1280, 6);
    expect(point!.y).toBeCloseTo(960, 6);
  });

  it('returns null for a zero-size element', () => {
    expect(
      clickToIntrinsicPixel(10, 10, { left: 0, top: 0, width: 0, height: 0 }, natural),
    ).toBeNull();
  });
});
