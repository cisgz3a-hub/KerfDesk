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
});

describe('elementToSubPaths — <circle> / <ellipse>', () => {
  it('approximates a circle with a 72-segment closed polygon', () => {
    const subs = elementToSubPaths(svgEl('<circle cx="10" cy="20" r="5"/>'));
    expect(subs).toHaveLength(1);
    expect(subs[0]?.closed).toBe(true);
    // 72 + 1 (closing point repeated at the end)
    expect(subs[0]?.points).toHaveLength(73);
    // Points should lie on the circle.
    for (const p of subs[0]?.points ?? []) {
      const d = Math.hypot(p.x - 10, p.y - 20);
      expect(d).toBeCloseTo(5);
    }
  });

  it('approximates an ellipse with rx ≠ ry', () => {
    const subs = elementToSubPaths(svgEl('<ellipse cx="0" cy="0" rx="10" ry="5"/>'));
    expect(subs[0]?.closed).toBe(true);
    expect(subs[0]?.points).toHaveLength(73);
  });

  it('returns no subpaths for non-positive radii', () => {
    expect(elementToSubPaths(svgEl('<circle cx="0" cy="0" r="0"/>'))).toEqual([]);
    expect(elementToSubPaths(svgEl('<ellipse cx="0" cy="0" rx="0" ry="5"/>'))).toEqual([]);
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
