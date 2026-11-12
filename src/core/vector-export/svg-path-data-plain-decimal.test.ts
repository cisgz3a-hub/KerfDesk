import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from '../scene';
import { formatSvgPathData } from './svg-path-data';

// Audit O2-P3-8 (Oracle audit O1): a subpath with an elliptical arc is written
// at full precision, and String(value) printed float noise such as
// 1.2246467991473532e-16. SVG 1.1's path grammar allows exponents, but simple
// path readers do not; the exporter must write plain decimals that still read
// back to exactly the same numbers.
describe('full-precision SVG path data has no exponent (O2-P3-8)', () => {
  const tiny = 1.2246467991473532e-16;
  const negativeTiny = -6.123233995736766e-17;
  const roundedCorner: CurveSubpath = {
    start: { x: tiny, y: 2 },
    closed: true,
    segments: [
      { kind: 'line', to: { x: 0, y: 8.000000000000002 } },
      {
        kind: 'elliptical-arc',
        radiusX: 2,
        radiusY: 2,
        rotationDeg: 0,
        largeArc: false,
        sweep: false,
        to: { x: 2, y: 10 },
      },
      { kind: 'line', to: { x: 10, y: 10 } },
      { kind: 'line', to: { x: negativeTiny, y: 2 } },
    ],
  };

  it('writes plain decimals that round-trip exactly', () => {
    const d = formatSvgPathData([roundedCorner], null);
    expect(d).not.toMatch(/e/i);
    const numbers = (d.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    expect(numbers).toContain(tiny);
    expect(numbers).toContain(negativeTiny);
    expect(numbers).toContain(8.000000000000002);
  });
});
