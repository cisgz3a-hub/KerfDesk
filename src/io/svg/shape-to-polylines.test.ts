import { describe, expect, it } from 'vitest';
import { elementToSubPaths } from './shape-to-polylines';

function svgEl(markup: string): Element {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    'image/svg+xml',
  );
  const root = doc.documentElement;
  const child = root.firstElementChild;
  if (child === null) throw new Error(`No child in: ${markup}`);
  return child;
}

describe('elementToSubPaths — <line>', () => {
  it('produces a single open 2-point polyline', () => {
    const subs = elementToSubPaths(svgEl('<line x1="0" y1="0" x2="10" y2="20"/>'));
    expect(subs).toEqual([
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
        closed: false,
      },
    ]);
  });

  it('resolves absolute CSS units to current SVG user units', () => {
    const subs = elementToSubPaths(svgEl('<line x1="0" y1="0" x2="1in" y2="101.6q"/>'));

    expect(subs[0]?.points[1]?.x).toBeCloseTo(96, 12);
    expect(subs[0]?.points[1]?.y).toBeCloseTo(96, 12);
  });
});

describe('elementToSubPaths — <polyline> / <polygon>', () => {
  it('parses polyline points', () => {
    const subs = elementToSubPaths(svgEl('<polyline points="0,0 10,0 10,10"/>'));
    expect(subs).toEqual([
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        closed: false,
      },
    ]);
  });

  // E-2: a polyline that returns to its start is a closed outline for kerf,
  // tabs and containment, exactly as fill already treats it.
  it('stores a polyline that returns to its start as the matching polygon', () => {
    expect(elementToSubPaths(svgEl('<polyline points="0,0 10,0 10,10 0,0"/>'))).toEqual(
      elementToSubPaths(svgEl('<polygon points="0,0 10,0 10,10"/>')),
    );
  });

  it('measures the closing gap in millimetres after the element scale', () => {
    // 5e-5 user units is 5e-5 mm at scale 1 (closed) but 5e-4 mm at scale 10 (open).
    for (const markup of [
      '<polyline points="0,0 10,0 10,10 0.00005,0"/>',
      '<path d="M0 0 L10 0 L10 10 L0.00005 0"/>',
    ]) {
      expect(elementToSubPaths(svgEl(markup), 1)[0]?.closed).toBe(true);
      expect(elementToSubPaths(svgEl(markup), 10)[0]?.closed).toBe(false);
    }
  });

  it('parses polygon points and closes them', () => {
    const subs = elementToSubPaths(svgEl('<polygon points="0,0 10,0 10,10"/>'));
    expect(subs[0]?.closed).toBe(true);
    expect(subs[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]);
  });
});

describe('elementToSubPaths — <rect>', () => {
  it('produces a closed 5-point polyline matching the four corners', () => {
    const subs = elementToSubPaths(svgEl('<rect x="5" y="10" width="20" height="30"/>'));
    expect(subs[0]?.closed).toBe(true);
    expect(subs[0]?.points).toEqual([
      { x: 5, y: 10 },
      { x: 25, y: 10 },
      { x: 25, y: 40 },
      { x: 5, y: 40 },
      { x: 5, y: 10 },
    ]);
  });

  it('returns no subpaths if width or height is zero', () => {
    expect(elementToSubPaths(svgEl('<rect x="0" y="0" width="0" height="10"/>'))).toEqual([]);
  });

  it('preserves rounded rect rx/ry as curved corner polylines', () => {
    const subs = elementToSubPaths(
      svgEl('<rect x="0" y="0" width="20" height="10" rx="5" ry="3"/>'),
    );
    expect(subs[0]?.closed).toBe(true);
    expect(subs[0]?.points.length).toBeGreaterThan(5);
    expect(subs[0]?.points[0]).toEqual({ x: 5, y: 0 });
  });
});

describe('elementToSubPaths — <circle> / <ellipse>', () => {
  it('approximates a circle with an adaptive closed polygon', () => {
    const subs = elementToSubPaths(svgEl('<circle cx="10" cy="20" r="5"/>'));
    expect(subs).toHaveLength(1);
    expect(subs[0]?.closed).toBe(true);
    expect(subs[0]?.points.length ?? 0).toBeGreaterThanOrEqual(25);
    // Points should lie on the circle.
    for (const p of subs[0]?.points ?? []) {
      const d = Math.hypot(p.x - 10, p.y - 20);
      expect(d).toBeCloseTo(5);
    }
  });

  it('approximates an ellipse with rx ≠ ry', () => {
    const subs = elementToSubPaths(svgEl('<ellipse cx="0" cy="0" rx="10" ry="5"/>'));
    expect(subs[0]?.closed).toBe(true);
    expect(subs[0]?.points.length ?? 0).toBeGreaterThanOrEqual(25);
  });

  it('scales circle segment count with radius', () => {
    const small = elementToSubPaths(svgEl('<circle cx="0" cy="0" r="5"/>'))[0]?.points.length ?? 0;
    const large =
      elementToSubPaths(svgEl('<circle cx="0" cy="0" r="200"/>'))[0]?.points.length ?? 0;
    expect(large).toBeGreaterThan(small);
  });

  it('returns no subpaths for non-positive radii', () => {
    expect(elementToSubPaths(svgEl('<circle cx="0" cy="0" r="0"/>'))).toEqual([]);
    expect(elementToSubPaths(svgEl('<ellipse cx="0" cy="0" rx="0" ry="5"/>'))).toEqual([]);
  });
});

// A-12: SVG 2 defines each basic shape by an equivalent path. Importing that
// path keeps the arcs as native curves, so compilation and export stay exact.
describe('elementToSubPaths — basic shapes keep native arcs', () => {
  const arc = (radiusX: number, radiusY: number, x: number, y: number) => ({
    kind: 'elliptical-arc',
    radiusX,
    radiusY,
    rotationDeg: 0,
    largeArc: false,
    sweep: true,
    to: { x, y },
  });
  const kinds = (markup: string) =>
    elementToSubPaths(svgEl(markup))[0]?.curve?.segments.map((segment) => segment.kind);

  it('imports a circle as four closed quarter arcs from its rightmost point', () => {
    const subs = elementToSubPaths(svgEl('<circle cx="10" cy="20" r="5"/>'));
    expect(subs).toHaveLength(1);
    expect(subs[0]?.closed).toBe(true);
    expect(subs[0]?.curve).toEqual({
      start: { x: 15, y: 20 },
      segments: [arc(5, 5, 10, 25), arc(5, 5, 5, 20), arc(5, 5, 10, 15), arc(5, 5, 15, 20)],
      closed: true,
    });
    // One closing point, landing exactly on the start.
    expect(subs[0]?.points.at(-1)).toEqual({ x: 15, y: 20 });
    expect(subs[0]?.points.at(-2)).not.toEqual({ x: 15, y: 20 });
  });

  it('imports an ellipse with both radii on its arcs', () => {
    const curve = elementToSubPaths(svgEl('<ellipse cx="0" cy="0" rx="10" ry="4"/>'))[0]?.curve;
    expect(curve?.start).toEqual({ x: 10, y: 0 });
    expect(curve?.segments).toEqual([
      arc(10, 4, 0, 4),
      arc(10, 4, -10, 0),
      arc(10, 4, 0, -4),
      arc(10, 4, 10, 0),
    ]);
  });

  it('imports a rounded rect as edges and corner arcs', () => {
    const curve = elementToSubPaths(
      svgEl('<rect x="0" y="0" width="20" height="10" rx="5" ry="3"/>'),
    )[0]?.curve;
    expect(curve?.start).toEqual({ x: 5, y: 0 });
    expect(curve?.segments).toEqual([
      { kind: 'line', to: { x: 15, y: 0 } },
      arc(5, 3, 20, 3),
      { kind: 'line', to: { x: 20, y: 7 } },
      arc(5, 3, 15, 10),
      { kind: 'line', to: { x: 5, y: 10 } },
      arc(5, 3, 0, 7),
      { kind: 'line', to: { x: 0, y: 3 } },
      arc(5, 3, 5, 0),
    ]);
    expect(curve?.closed).toBe(true);
  });

  it('applies the SVG 2 corner radius rules', () => {
    // One radius given: the other copies it.
    expect(
      elementToSubPaths(svgEl('<rect width="20" height="10" rx="2"/>'))[0]?.curve?.segments[1],
    ).toEqual(arc(2, 2, 20, 2));
    // A negative radius is invalid, so it is auto and copies the other.
    expect(
      elementToSubPaths(svgEl('<rect width="20" height="10" rx="-4" ry="3"/>'))[0]?.curve
        ?.segments[1],
    ).toEqual(arc(3, 3, 20, 3));
    // Radii clamp to half each side; the edges they use up are left out, not zero length.
    expect(kinds('<rect width="20" height="10" rx="50" ry="50"/>')).toEqual([
      'elliptical-arc',
      'elliptical-arc',
      'elliptical-arc',
      'elliptical-arc',
    ]);
    expect(kinds('<rect width="20" height="10" rx="5" ry="50"/>')).toEqual([
      'line',
      'elliptical-arc',
      'elliptical-arc',
      'line',
      'elliptical-arc',
      'elliptical-arc',
    ]);
  });

  it('keeps square corners as a plain closed rectangle', () => {
    expect(
      elementToSubPaths(svgEl('<rect width="20" height="10" rx="0"/>'))[0]?.curve,
    ).toBeUndefined();
  });

  it('flattens the compatibility polyline within the 0.025 mm machine tolerance', () => {
    // The chord midpoints are where the polyline strays furthest from the circle.
    const worstMm = (scale: number): number => {
      const points =
        elementToSubPaths(svgEl('<circle cx="0" cy="0" r="11"/>'), scale)[0]?.points ?? [];
      let worst = 0;
      for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1] ?? { x: 0, y: 0 };
        const b = points[index] ?? { x: 0, y: 0 };
        worst = Math.max(worst, Math.abs(Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2) - 11));
      }
      return worst * scale;
    };
    expect(worstMm(1)).toBeLessThanOrEqual(0.025);
    expect(worstMm(10)).toBeLessThanOrEqual(0.025);
  });
});

describe('elementToSubPaths — <path>', () => {
  it('dispatches to parsePathD', () => {
    const subs = elementToSubPaths(svgEl('<path d="M 0 0 L 10 10 Z"/>'));
    expect(subs).toHaveLength(1);
    expect(subs[0]?.closed).toBe(true);
  });
});

describe('elementToSubPaths — unsupported tags', () => {
  it('returns an empty array for tags not in the Phase A set', () => {
    expect(elementToSubPaths(svgEl('<text>hello</text>'))).toEqual([]);
    expect(elementToSubPaths(svgEl('<image href="x.png" width="10" height="10"/>'))).toEqual([]);
  });
});
