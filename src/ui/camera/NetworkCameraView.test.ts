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

  // CAM-01: the <img> renders object-fit:contain in a 4:3 box, so a 16:9 frame
  // is letterboxed. Clicks must map through the fitted content rect, not the
  // full element rect, and a click in the letterbox bar must be ignored.
  describe('object-fit letterboxing (16:9 frame in a 4:3 element)', () => {
    const wide = { width: 1920, height: 1080 }; // content rect: 400x225, bars 37.5px

    it('maps a click on the fitted image top edge to intrinsic y≈0', () => {
      // element y = 37.5 (top of the fitted image); centre x.
      const point = clickToIntrinsicPixel(300, 50 + 37.5, rect, wide);
      expect(point).not.toBeNull();
      expect(point!.x).toBeCloseTo(960, 6);
      expect(point!.y).toBeCloseTo(0, 6);
    });

    it('maps a click on the fitted image bottom edge to intrinsic height', () => {
      const point = clickToIntrinsicPixel(300, 50 + 262.5, rect, wide);
      expect(point!.y).toBeCloseTo(1080, 6);
    });

    it('returns null for a click inside the letterbox bar', () => {
      // element y = 10 is above the fitted image (top bar ends at 37.5).
      expect(clickToIntrinsicPixel(300, 50 + 10, rect, wide)).toBeNull();
    });
  });
});
