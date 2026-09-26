import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { generateCameraBedTarget } from './camera-bed-target-pattern';
import { compileJob } from './compile-job';

describe('generateCameraBedTarget', () => {
  const pattern = generateCameraBedTarget({ area: { x: 5, y: 5, width: 390, height: 390 } });

  it('emits one object per mark on a single fill layer', () => {
    expect(pattern.objects).toHaveLength(pattern.layout.marks.length);
    expect(pattern.layer.mode).toBe('fill');
    expect(pattern.scene.layers).toHaveLength(1);
  });

  it('draws each ring as two circles and each anchor as one', () => {
    for (const [index, object] of pattern.objects.entries()) {
      const mark = pattern.layout.marks[index];
      expect(object.paths[0]?.polylines).toHaveLength(mark?.anchor === true ? 1 : 2);
    }
  });

  it('centres every mark on its layout position', () => {
    for (const [index, object] of pattern.objects.entries()) {
      const mark = pattern.layout.marks[index];
      expect(object.transform.x + object.bounds.maxX / 2).toBeCloseTo(mark?.x ?? 0, 9);
      expect(object.transform.y + object.bounds.maxY / 2).toBeCloseTo(mark?.y ?? 0, 9);
    }
  });

  it('burns the ring band and leaves the ring hole unburned when compiled', () => {
    // Rear-left origin keeps machine coordinates equal to bed coordinates.
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      bedWidth: 400,
      bedHeight: 400,
      origin: 'rear-left' as const,
    };
    const job = compileJob(pattern.scene, device);
    const ring = pattern.layout.marks.find((m) => !m.anchor);
    const outer = pattern.layout.ringDiameterMm / 2;
    const hole = outer - pattern.layout.ringWidthMm;
    const distances = job.groups.flatMap((group) =>
      group.kind === 'fill'
        ? group.segments.flatMap((segment) =>
            sampleAlong(segment.polyline).map((p) =>
              Math.hypot(p.x - (ring?.x ?? 0), p.y - (ring?.y ?? 0)),
            ),
          )
        : [],
    );
    expect(distances.filter((d) => d > hole + 0.3 && d < outer - 0.3).length).toBeGreaterThan(10);
    expect(distances.filter((d) => d < hole - 0.3)).toHaveLength(0);
  });
});

// Points every 0.1 mm along a burn polyline, so a scanline that crosses the
// hole is caught between its end points.
function sampleAlong(
  polyline: ReadonlyArray<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  const samples = [];
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1];
    const b = polyline[i];
    if (a === undefined || b === undefined) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
    for (let k = 0; k <= steps; k += 1) {
      samples.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
    }
  }
  return samples;
}
