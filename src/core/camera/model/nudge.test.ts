import { describe, expect, it } from 'vitest';
import { bedPoint, pixelToBed, projectWorldPoint } from './camera-model';
import { overheadPose, savedCameraModel, wideLens } from './model-fixtures';
import { measureNudge, nudgedCameraModel, nudgeSizeMm, NUDGE_SEARCH_MM } from './nudge';

const lens = wideLens();
const pose = overheadPose();

// Where `bed` shows in the picture of a camera whose picture is off by `off`:
// the true camera sees the burn where the saved model would put `bed - off`.
function ringSeenAt(bed: { x: number; y: number }, heightMm: number) {
  const pixel = projectWorldPoint(lens, pose, bedPoint(bed.x, bed.y, heightMm));
  if (pixel === null) throw new Error('fixture point is off the picture');
  return { x: pixel.x, y: pixel.y, area: 300, anchor: false };
}

describe('measureNudge', () => {
  it('measures how far the picture is from the burn, on the sheet the ring is on', () => {
    // The picture shows the ring 1.5 mm left of and 0.5 mm above where it burned.
    const ring = ringSeenAt({ x: 198.5, y: 199.5 }, 3);
    const measure = measureNudge({
      lens,
      pose,
      rings: [ring],
      burnedAtMm: { x: 200, y: 200 },
      heightMm: 3,
    });
    expect(measure.kind).toBe('found');
    if (measure.kind !== 'found') return;
    expect(measure.offsetMm.x).toBeCloseTo(1.5, 6);
    expect(measure.offsetMm.y).toBeCloseTo(0.5, 6);
    expect(nudgeSizeMm(measure.offsetMm)).toBeCloseTo(Math.hypot(1.5, 0.5), 6);
  });

  it('ignores rings far from the burn and solid anchor discs', () => {
    const far = ringSeenAt({ x: 200 + NUDGE_SEARCH_MM + 5, y: 200 }, 0);
    const anchor = { ...ringSeenAt({ x: 201, y: 200 }, 0), anchor: true };
    expect(
      measureNudge({
        lens,
        pose,
        rings: [far, anchor],
        burnedAtMm: { x: 200, y: 200 },
        heightMm: 0,
      }),
    ).toEqual({ kind: 'not-found' });
  });

  it('refuses to guess between two rings near the burn', () => {
    const rings = [ringSeenAt({ x: 199, y: 200 }, 0), ringSeenAt({ x: 210, y: 200 }, 0)];
    expect(
      measureNudge({ lens, pose, rings, burnedAtMm: { x: 200, y: 200 }, heightMm: 0 }),
    ).toEqual({ kind: 'ambiguous', rings: 2 });
  });
});

describe('nudgedCameraModel', () => {
  it('moves every point of the picture by the offset, at any height', () => {
    const record = savedCameraModel();
    const offset = { x: 1.5, y: -0.75 };
    const nudged = nudgedCameraModel(record, offset);
    for (const pixel of [
      { x: 640, y: 360 },
      { x: 200, y: 150 },
      { x: 1000, y: 600 },
    ]) {
      for (const heightMm of [0, 12]) {
        const before = pixelToBed(record.lens, record.pose, pixel, heightMm);
        const after = pixelToBed(nudged.lens, nudged.pose, pixel, heightMm);
        if (before === null || after === null) throw new Error('pixel has no ray');
        expect(after.x - before.x).toBeCloseTo(offset.x, 6);
        expect(after.y - before.y).toBeCloseTo(offset.y, 6);
      }
    }
    // The calibration's own measurements are untouched.
    expect(nudged.accuracy).toBe(record.accuracy);
    expect(nudged.lens).toBe(record.lens);
  });

  it('lines the picture up with the burn the measure found', () => {
    const ring = ringSeenAt({ x: 197, y: 202 }, 0);
    const burnedAtMm = { x: 200, y: 200 };
    const measure = measureNudge({ lens, pose, rings: [ring], burnedAtMm, heightMm: 0 });
    if (measure.kind !== 'found') throw new Error('ring not found');
    const nudged = nudgedCameraModel(savedCameraModel(), measure.offsetMm);
    const seen = pixelToBed(nudged.lens, nudged.pose, ring, 0);
    expect(seen?.x).toBeCloseTo(burnedAtMm.x, 6);
    expect(seen?.y).toBeCloseTo(burnedAtMm.y, 6);
  });
});
