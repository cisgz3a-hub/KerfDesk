// Rolling audit v11 W5-P1-1 (ADR-159 Amendment 3): a floating-point-noise
// LWPOLYLINE bulge is a straight edge. Through its centre, 1e17 mm away, the
// canonical cubic looped tens of millimetres off the edge, so a 40 x 30 mm
// plate compiled 70-141 mm wide, or bed-fitted to 29 % under a false
// "larger than the bed" notice.
import { describe, expect, it } from 'vitest';
import { curveSubpathBounds, type ImportedSvg } from '../../core/scene';
import { isNearStraightBulge } from '../../core/geometry/near-straight-arc';
import { bulgeCurveSegment } from './dxf-native-curves';
import { bulgeSegment } from './dxf-curve-sampling';
import { parseDxf } from './parse-dxf';

const dxf = (entities: string[]): string =>
  [
    ...['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC'],
    ...['0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'],
  ].join('\n');

// A closed 40 x 30 mm plate with `bulge` on its bottom edge only.
const plate = (bulge: string): string =>
  dxf([
    ...['0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1'],
    ...['10', '0', '20', '0', '42', bulge],
    ...['10', '40', '20', '0'],
    ...['10', '40', '20', '30'],
    ...['10', '0', '20', '30'],
  ]);

function imported(text: string): ImportedSvg {
  const result = parseDxf({ dxfText: text, id: 'p', source: 'p.dxf' });
  if (result.kind !== 'ok' || result.object === null) throw new Error(JSON.stringify(result));
  return result.object as ImportedSvg;
}

const NOISE_BULGES = [
  '2.4492935982947064e-17',
  '1e-17',
  '-1e-17',
  '1e-18',
  '1e-19',
  '1e-20',
  '6.123233995736766e-17',
  '1.2246467991473532e-16',
  '1e-12',
];

describe('DXF near-zero bulges are straight edges (W5-P1-1)', () => {
  it.each(NOISE_BULGES)('a %s bulge keeps the 40 x 30 mm plate 40 x 30', (bulge) => {
    const object = imported(plate(bulge));
    expect(object.bounds).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 30 });
    const curve = object.paths[0]?.curves?.[0];
    expect(curve?.segments.map((segment) => segment.kind)).toEqual([
      'line',
      'line',
      'line',
      'line',
    ]);
    if (curve !== undefined) {
      expect(curveSubpathBounds(curve)).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 30 });
    }
  });

  it('keeps a diagonal edge on its chord', () => {
    for (const bulge of [6.123233995736766e-17, 1e-18]) {
      const segments = bulgeCurveSegment({ x: 0, y: 10 }, { x: 10, y: 0 }, bulge);
      expect(segments).toEqual([{ kind: 'line', to: { x: 10, y: 0 } }]);
      expect(bulgeSegment({ x: 0, y: 10 }, { x: 10, y: 0 }, bulge)).toEqual([{ x: 10, y: 0 }]);
    }
  });

  it('still bends a small real bulge, with its cubic on the arc and near the chord', () => {
    // bulge 1e-6 on a 40 mm chord: sagitta 2e-5 mm, radius 1e7 mm.
    const segments = bulgeCurveSegment({ x: 0, y: 0 }, { x: 40, y: 0 }, 1e-6);
    expect(segments.map((segment) => segment.kind)).toEqual(['cubic']);
    const cubic = segments[0];
    if (cubic?.kind !== 'cubic') throw new Error('expected a cubic');
    for (const point of [cubic.control1, cubic.control2]) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(40);
      expect(Math.abs(point.y)).toBeLessThan(1e-4);
    }
  });

  it('draws the line at a sagitta of 1e-9 of the chord', () => {
    expect(isNearStraightBulge(0)).toBe(true);
    expect(isNearStraightBulge(2e-9)).toBe(true);
    expect(isNearStraightBulge(-2e-9)).toBe(true);
    expect(isNearStraightBulge(2.1e-9)).toBe(false);
    expect(isNearStraightBulge(1)).toBe(false);
  });
});
