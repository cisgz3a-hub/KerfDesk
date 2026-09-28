import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { polylineStaysInside } from './polyline-stays-inside';

function square(from: number, to: number): Vec2[] {
  return [
    { x: from, y: from },
    { x: to, y: from },
    { x: to, y: to },
    { x: from, y: to },
  ];
}

const BOX = [square(0, 10)];
// A band between two squares: the inner one is its hole.
const BAND = [square(0, 10), square(3, 7)];

describe('polylineStaysInside', () => {
  it('keeps a path wholly inside', () => {
    expect(
      polylineStaysInside(
        [
          { x: 1, y: 1 },
          { x: 9, y: 2 },
          { x: 5, y: 8 },
        ],
        BOX,
      ),
    ).toBe(true);
  });

  it.each([
    [
      'crosses out and back',
      [
        { x: 1, y: 1 },
        { x: 12, y: 5 },
        { x: 1, y: 9 },
      ],
    ],
    [
      'starts outside',
      [
        { x: -1, y: 5 },
        { x: -2, y: 5 },
      ],
    ],
    [
      'touches an edge',
      [
        { x: 5, y: 5 },
        { x: 10, y: 5 },
      ],
    ],
    [
      'touches a corner',
      [
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ],
    ],
    [
      'runs along an edge',
      [
        { x: 0, y: 2 },
        { x: 0, y: 8 },
      ],
    ],
  ] as const)('refuses a path that %s', (_name, path) => {
    expect(polylineStaysInside(path, BOX)).toBe(false);
  });

  it('reads holes even-odd', () => {
    const inBand = [
      { x: 1, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: 2 },
    ];
    const inHole = [
      { x: 4, y: 4 },
      { x: 6, y: 6 },
    ];
    const intoHole = [
      { x: 1, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(polylineStaysInside(inBand, BAND)).toBe(true);
    expect(polylineStaysInside(inHole, BAND)).toBe(false);
    expect(polylineStaysInside(intoHole, BAND)).toBe(false);
  });

  it('treats a single point as a point: inside, on the edge, outside', () => {
    expect(polylineStaysInside([{ x: 5, y: 5 }], BOX)).toBe(true);
    expect(polylineStaysInside([{ x: 10, y: 5 }], BOX)).toBe(false);
    expect(polylineStaysInside([{ x: 11, y: 5 }], BOX)).toBe(false);
  });

  it('answers no for an empty path or no region', () => {
    expect(polylineStaysInside([], BOX)).toBe(false);
    expect(polylineStaysInside([{ x: 5, y: 5 }], [])).toBe(false);
  });

  it('ignores a repeated contour vertex off the path', () => {
    const repeated = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, ...square(0, 10).slice(2)];
    const path = [
      { x: 2, y: 1 },
      { x: 9.5, y: 0.5 },
      { x: 9.9, y: 5 },
    ];
    expect(polylineStaysInside(path, [repeated])).toBe(true);
  });

  // A relief ramp that doubles back along a 0.001 mm-wide loop, which made
  // Clipper's open-path clip loop forever (ADR-489 Amendment 1).
  it('handles a path that doubles back on itself', () => {
    const loop = [
      { x: 8.927, y: 19.5405 },
      { x: 7.226, y: 19.54 },
      { x: 10.628, y: 19.54 },
      { x: 10.628, y: 19.541 },
      { x: 7.226, y: 19.54 },
      { x: 10.628, y: 19.54 },
      { x: 10.628, y: 19.541 },
      { x: 7.27209101525714, y: 19.54001354821142 },
      { x: 7.226, y: 19.54 },
      { x: 5.088, y: 19.372 },
    ];
    expect(polylineStaysInside(loop, [square(0, 24)])).toBe(true);
    const hole = [
      { x: 10, y: 19 },
      { x: 11, y: 19 },
      { x: 11, y: 20 },
      { x: 10, y: 20 },
    ];
    expect(polylineStaysInside(loop, [square(0, 24), hole])).toBe(false);
  });

  it('stays exact on a long path against a detailed region', () => {
    const circle = Array.from({ length: 2000 }, (_, index) => {
      const angle = (index / 2000) * 2 * Math.PI;
      return { x: 50 * Math.cos(angle), y: 50 * Math.sin(angle) };
    });
    const spiral = Array.from({ length: 5000 }, (_, index) => {
      const angle = index * 0.05;
      const radius = (49 * index) / 5000;
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
    expect(polylineStaysInside(spiral, [circle])).toBe(true);
    expect(polylineStaysInside([...spiral, { x: 60, y: 0 }], [circle])).toBe(false);
  });
});
