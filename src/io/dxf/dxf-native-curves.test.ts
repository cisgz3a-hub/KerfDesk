import { describe, expect, it } from 'vitest';
import { curveSubpathBounds, flattenCurveSubpath } from '../../core/scene';
import { bulgeCurveSegment, circleCurve, ellipseArcCurve } from './dxf-native-curves';

describe('DXF native curve conversion', () => {
  it('represents a circle as four closed cubic quadrants', () => {
    const curve = circleCurve({ x: 5, y: 7 }, 3);
    expect(curve.closed).toBe(true);
    expect(curve.segments).toHaveLength(4);
    expect(curve.segments.every((segment) => segment.kind === 'cubic')).toBe(true);
    expect(curveSubpathBounds(curve)).toEqual({ minX: 2, minY: 4, maxX: 8, maxY: 10 });
  });

  it('preserves a rotated ellipse as bounded cubic segments', () => {
    const curve = ellipseArcCurve({ x: 0, y: 0 }, { x: 8, y: 6 }, 0.5, 0, Math.PI * 2, true);
    const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.001 });
    expect(flattened.kind).toBe('ok');
    expect(curve.segments).toHaveLength(4);
    expect(curve.closed).toBe(true);
  });

  it('converts bulge arcs to cubics while zero bulges stay lines', () => {
    const curved = bulgeCurveSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    expect(curved).toHaveLength(2);
    expect(curved.every((segment) => segment.kind === 'cubic')).toBe(true);
    expect(curved.at(-1)?.to).toEqual({ x: 10, y: 0 });
    expect(bulgeCurveSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toEqual([
      { kind: 'line', to: { x: 10, y: 0 } },
    ]);
  });
});
