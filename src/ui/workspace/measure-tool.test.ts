import { describe, expect, it } from 'vitest';
import { constrainMeasureEnd, measureReadout } from './measure-tool';

describe('measure tool helpers', () => {
  it('preserves radial distance through 720 directions and shifted 45-degree snaps', () => {
    const start = { x: 12345, y: -67890 };
    for (let step = 0; step < 720; step += 1) {
      const angle = (step * Math.PI) / 360;
      const end = { x: start.x + 123 * Math.cos(angle), y: start.y + 123 * Math.sin(angle) };
      expect(measureReadout({ start, end }).distanceMm).toBeCloseTo(123, 8);
      const snapped = measureReadout({ start, end: constrainMeasureEnd(start, end, true) });
      expect(snapped.distanceMm).toBeCloseTo(123, 8);
      expect(snapped.angleDeg / 45).toBeCloseTo(Math.round(snapped.angleDeg / 45), 8);
    }
  });

  it('formats distance, delta, and angle for a temporary workspace measurement', () => {
    const readout = measureReadout({
      start: { x: 10, y: 20 },
      end: { x: 40, y: 60 },
    });

    expect(readout.distanceMm).toBeCloseTo(50, 6);
    expect(readout.dxMm).toBe(30);
    expect(readout.dyMm).toBe(40);
    expect(readout.angleDeg).toBeCloseTo(53.1301, 3);
    expect(readout.label).toBe('50.00 mm | dx 30.00 | dy 40.00 | 53.1 deg');
  });

  it('locks Shift-drag measurement to the nearest 45 degree axis', () => {
    const end = constrainMeasureEnd({ x: 0, y: 0 }, { x: 22, y: 3 }, true);

    expect(end.x).toBeCloseTo(Math.hypot(22, 3), 6);
    expect(end.y).toBeCloseTo(0, 6);
  });

  it('leaves unconstrained measurement endpoints unchanged', () => {
    const end = constrainMeasureEnd({ x: 5, y: 6 }, { x: 7, y: 9 }, false);

    expect(end).toEqual({ x: 7, y: 9 });
  });
});
