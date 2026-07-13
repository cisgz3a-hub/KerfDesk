import { describe, expect, it } from 'vitest';
import { curveSubpathBounds, flattenCurveSubpath } from '../scene';
import { parametricEllipseCurve } from './ellipse-curve';

describe('parametricEllipseCurve', () => {
  it('builds a closed four-cubic ellipse with an exact seam', () => {
    const curve = parametricEllipseCurve({
      center: { x: 20, y: 10 },
      majorAxis: { x: 20, y: 0 },
      ratio: 0.5,
      startParam: 0,
      sweep: Math.PI * 2,
      closed: true,
    });
    expect(curve.segments).toHaveLength(4);
    expect(curve.segments.at(-1)?.to).toEqual(curve.start);
    expect(curveSubpathBounds(curve)).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 20 });
  });

  it('subdivides sweeps larger than a quarter turn', () => {
    const curve = parametricEllipseCurve({
      center: { x: 0, y: 0 },
      majorAxis: { x: 10, y: 0 },
      ratio: 1,
      startParam: 0,
      sweep: Math.PI,
      closed: false,
    });
    expect(curve.segments).toHaveLength(2);
    expect(flattenCurveSubpath(curve, { toleranceMm: 0.01 }).kind).toBe('ok');
  });
});
