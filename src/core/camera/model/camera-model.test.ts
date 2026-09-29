import { describe, expect, it } from 'vitest';
import {
  bedMapper,
  bedPoint,
  cameraCentre,
  pixelToBed,
  projectWorldPoint,
  scaleLens,
} from './camera-model';
import { overheadPose, wideLens } from './model-fixtures';

describe('camera model', () => {
  const lens = wideLens();
  const pose = overheadPose();

  it('places the camera centre where the pose was built', () => {
    const centre = cameraCentre(pose);
    expect(centre.x).toBeCloseTo(200, 6);
    expect(centre.y).toBeCloseTo(-30, 6);
    expect(centre.z).toBeCloseTo(-360, 6);
  });

  it.each([0, 3, 25])('round-trips bed points at %i mm through the lens', (height) => {
    for (const [x, y] of [
      [20, 20],
      [200, 200],
      [380, 390],
      [15, 360],
    ] as const) {
      const pixel = projectWorldPoint(lens, pose, bedPoint(x, y, height));
      expect(pixel).not.toBeNull();
      const back = pixelToBed(lens, pose, pixel ?? { x: 0, y: 0 }, height);
      expect(back?.x).toBeCloseTo(x, 6);
      expect(back?.y).toBeCloseTo(y, 6);
    }
  });

  it('sees a raised surface at a different bed position (parallax is modelled)', () => {
    const pixel = projectWorldPoint(lens, pose, bedPoint(350, 350, 0));
    const onBed = pixelToBed(lens, pose, pixel ?? { x: 0, y: 0 }, 0);
    const onBoard = pixelToBed(lens, pose, pixel ?? { x: 0, y: 0 }, 20);
    // The ray from a camera at (200, -30) drops toward the far corner, so a
    // surface 20 mm up meets it nearer the camera: shifted back toward it.
    expect(onBed?.y).toBeCloseTo(350, 6);
    expect(onBoard?.y ?? 0).toBeLessThan(350 - 15);
  });

  it('returns null for points behind the camera', () => {
    expect(projectWorldPoint(lens, pose, { x: 200, y: -200, z: -1000 })).toBeNull();
  });

  it('matches the one-off mapper exactly', () => {
    const map = bedMapper(lens, pose);
    const pixel = { x: 400, y: 300 };
    expect(map(pixel, 5)).toEqual(pixelToBed(lens, pose, pixel, 5));
  });

  it('places no bed point for a pixel beyond what a folding lens can produce', () => {
    // theta_d(theta) of this lens peaks at about 0.674: a pixel farther out has
    // no ray, where it used to land on a plausible bed point such as (32.4, 6.5).
    const folding = { ...lens, distortion: [-0.041, 0.046, 0.581, -1.966] as const };
    const { fx, fy, cx, cy } = folding.intrinsics;
    const at = (radius: number) => ({
      x: cx - (radius * fx) / Math.SQRT2,
      y: cy - (radius * fy) / Math.SQRT2,
    });
    expect(pixelToBed(folding, pose, at(0.72), 3)).toBeNull();
    expect(bedMapper(folding, pose)(at(0.8), 3)).toBeNull();
    // Inside the range the same lens still maps a pixel and back exactly.
    const seen = pixelToBed(folding, pose, at(0.6), 3);
    const pixel = projectWorldPoint(folding, pose, bedPoint(seen?.x ?? 0, seen?.y ?? 0, 3));
    expect(pixel?.x).toBeCloseTo(at(0.6).x, 6);
    expect(pixel?.y).toBeCloseTo(at(0.6).y, 6);
  });

  it('rescales a lens to a resized frame about the pixel grid', () => {
    const half = scaleLens(lens, 640, 360);
    const full = projectWorldPoint(lens, pose, bedPoint(100, 250));
    const small = projectWorldPoint(half, pose, bedPoint(100, 250));
    expect(small?.x).toBeCloseTo(((full?.x ?? 0) + 0.5) / 2 - 0.5, 6);
    expect(small?.y).toBeCloseTo(((full?.y ?? 0) + 0.5) / 2 - 0.5, 6);
  });
});
