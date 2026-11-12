import { describe, expect, it } from 'vitest';
import type { TextRenderResult } from './text-to-polylines';
import { bendTextRender, clampBend } from './text-bend';

const RENDERED: TextRenderResult = {
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 5 },
            { x: 10, y: 5 },
            { x: 20, y: 5 },
          ],
        },
      ],
      curves: [
        {
          start: { x: 0, y: 5 },
          segments: [
            {
              kind: 'cubic',
              control1: { x: 5, y: 5 },
              control2: { x: 15, y: 5 },
              to: { x: 20, y: 5 },
            },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('bendTextRender', () => {
  it('is byte-stable at zero bend', () => {
    expect(bendTextRender(RENDERED, 0)).toBe(RENDERED);
  });

  it('bends the edges while retaining canonical cubic geometry', () => {
    const bent = bendTextRender(RENDERED, 90);
    const path = bent.paths[0];
    if (path === undefined) throw new Error('Bent path missing');
    const polyline = path.polylines[0];
    const curve = path.curves?.[0];
    if (polyline === undefined || curve === undefined) throw new Error('Bent geometry missing');
    // Bending splits each edge into equal pieces (O7-P2-2); the source's middle
    // point stays the middle one.
    const points = polyline.points;
    const left = points[0];
    const middle = points[(points.length - 1) / 2];
    const right = points.at(-1);
    if (left === undefined || middle === undefined || right === undefined) {
      throw new Error('Bent points missing');
    }
    expect(left.y).toBeGreaterThan(middle.y);
    expect(right.y).toBeGreaterThan(middle.y);
    expect(curve.segments[0]?.kind).toBe('cubic');
    expect(bent.bounds.minX).toBe(0);
    expect(bent.bounds.minY).toBe(0);
  });

  it('clamps hostile and non-finite input', () => {
    expect(clampBend(999)).toBe(180);
    expect(clampBend(-999)).toBe(-180);
    expect(clampBend(Number.NaN)).toBe(0);
  });

  // L3-P1-2: bent variable records align on this anchor, so it must land
  // exactly where the glyphs' own baseline point lands.
  it.each([0, 10, 20])('carries a baseline anchor at x %s onto the arc with the glyphs', (x) => {
    const baseline = 8;
    const marked: TextRenderResult = {
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: false,
              points: [0, 10, 20].map((at) => ({ x: at, y: baseline })),
            },
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 10 },
              ],
            },
          ],
        },
      ],
      anchor: { x, y: baseline },
    };
    for (const bend of [60, -60, 180]) {
      const bent = bendTextRender(marked, bend);
      // Both edges split into the same number of pieces (O7-P2-2).
      const points = bent.paths[0]?.polylines[0]?.points ?? [];
      const landed = points[(x / 10) * ((points.length - 1) / 2)];
      expect(bent.anchor?.x).toBeCloseTo(landed?.x ?? NaN, 12);
      expect(bent.anchor?.y).toBeCloseTo(landed?.y ?? NaN, 12);
    }
  });

  // Audit S7-P2-3: any non-zero Bend threw "Maximum call stack size exceeded"
  // once the text passed about 120,000 points.
  it('bends text with more points than a call can take as arguments', () => {
    const pointCount = 300_000;
    const points = Array.from({ length: pointCount }, (_, index) => ({
      x: (index / (pointCount - 1)) * 200,
      y: index % 2,
    }));
    const long: TextRenderResult = {
      bounds: { minX: 0, minY: 0, maxX: 200, maxY: 1 },
      paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
    };
    const bent = bendTextRender(long, 45);
    expect(bent.paths[0]?.polylines[0]?.points).toHaveLength(pointCount);
    expect(bent.bounds.minX).toBe(0);
    expect(bent.bounds.minY).toBe(0);
    expect(bent.bounds.maxX).toBeGreaterThan(100);
  });
});
