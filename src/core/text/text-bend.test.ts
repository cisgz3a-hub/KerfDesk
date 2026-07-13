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
    const [left, middle, right] = polyline.points;
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
});
