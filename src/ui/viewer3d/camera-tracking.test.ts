import { describe, expect, it } from 'vitest';
import { trackingPlacement } from './camera-tracking';

const bounds = { minX: 10, maxX: 110, minY: 20, maxY: 120, minZ: -5, maxZ: 5 };
const point = { x: 80, y: 70, z: -3 };

describe('progress camera placement', () => {
  it('targets the actual point including Z without mutating it', () => {
    const view = trackingPlacement({ mode: 'follow', point, progress: 0.3 }, bounds, 1);
    expect(view?.target).toEqual(point);
    expect(view?.position.z).toBeGreaterThan(point.z);
  });

  it('changes views with progress while Follow holds a steady angle', () => {
    const view = (mode: 'follow' | 'auto', progress: number) =>
      trackingPlacement({ mode, point, progress }, bounds, 1);
    expect(view('auto', 0.1)).not.toEqual(view('auto', 0.5));
    expect(view('auto', 0.5)).toEqual(view('auto', 0.5));
    expect(view('follow', 0.1)).toEqual(view('follow', 0.9));
  });

  it('keeps a steady angle for reduced motion and widens framing for narrow panes', () => {
    const reduced = (progress: number) =>
      trackingPlacement({ mode: 'auto', point, progress }, bounds, 1, true);
    expect(reduced(0.1)).toEqual(reduced(0.7));
    const narrow = trackingPlacement({ mode: 'follow', point, progress: 0 }, bounds, 0.5);
    expect(narrow!.position.z - point.z).toBeCloseTo((reduced(0)!.position.z - point.z) * 2);
  });

  it('does not move for manual mode, missing positions, or nonfinite telemetry', () => {
    expect(trackingPlacement({ mode: 'manual', point, progress: 0 }, bounds, 1)).toBeNull();
    expect(trackingPlacement({ mode: 'auto', point: null, progress: 0 }, bounds, 1)).toBeNull();
    expect(
      trackingPlacement({ mode: 'auto', point: { ...point, x: NaN }, progress: 0 }, bounds, 1),
    ).toBeNull();
    expect(
      trackingPlacement({ mode: 'auto', point, progress: NaN }, null, NaN)?.position.x,
    ).toBeTypeOf('number');
  });
});
