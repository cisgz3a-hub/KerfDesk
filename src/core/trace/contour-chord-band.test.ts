import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { fitSmoothCurve } from './centerline/curve-fit';
import { denseChordBand } from './contour-chord-band';

// A closed ring along a long rectangle whose long sides carry a +-0.4 px
// staircase wobble; `vertices` picks the four corners out of it by reference.
function wobblyBar(length: number, width: number): { dense: Vec2[]; vertices: Vec2[] } {
  const wobble = (x: number): number => 0.4 * (x % 2 === 0 ? 1 : -1);
  const sides: Vec2[][] = [
    Array.from({ length }, (_, x) => ({ x, y: x === 0 ? 0 : wobble(x) })),
    Array.from({ length: width }, (_, y) => ({ x: length, y })),
    Array.from({ length }, (_, i) => ({ x: length - i, y: i === 0 ? width : width + wobble(i) })),
    Array.from({ length: width }, (_, i) => ({ x: 0, y: width - i })),
  ];
  return { dense: sides.flat(), vertices: sides.map((side) => side[0] as Vec2) };
}

function offsetFrom(p: Vec2, a: Vec2, b: Vec2): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return ((p.x - a.x) * -(b.y - a.y) + (p.y - a.y) * (b.x - a.x)) / len;
}

describe('dense chord bands for the binary resample (ADR-440)', () => {
  it('holds a long straight run with staircase wobble on its chord', () => {
    const { dense, vertices } = wobblyBar(120, 3);
    const band = denseChordBand(dense, vertices)(vertices[0] as Vec2, vertices[1] as Vec2);
    expect(band).not.toBeNull();
    // The run's wobble averages to ~0; its mean, not its extremes, bounds it.
    expect(Math.abs(band?.below ?? 1)).toBeLessThan(0.05);
    expect(Math.abs(band?.above ?? 1)).toBeLessThan(0.05);
  });

  it('keeps an arc its sagitta, on the side it bulges', () => {
    // Quarter of a radius-60 circle, as one long chord (length ~85 px).
    const dense: Vec2[] = [];
    for (let i = 0; i <= 90; i += 1) {
      const a = (i * Math.PI) / 180;
      dense.push({ x: 60 * Math.cos(a), y: 60 * Math.sin(a) });
    }
    dense.push({ x: -1, y: 0 });
    const a = dense[0] as Vec2;
    const b = dense[90] as Vec2;
    const band = denseChordBand(dense, [a, b])(a, b);
    const sagitta = 60 * (1 - Math.cos(Math.PI / 4));
    // The arc bulges to the chord's right (away from the centre).
    const bulge = Math.min(...dense.slice(1, 90).map((p) => offsetFrom(p, a, b)));
    expect(bulge).toBeCloseTo(-sagitta, 1);
    expect(band?.below).toBeCloseTo(bulge, 6);
    expect(band?.above).toBeCloseTo(0, 6);
  });

  it('keeps a short chord to its stretch range only', () => {
    const dense: Vec2[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0.5 },
      { x: 6, y: -0.3 },
      { x: 9, y: 0 },
      { x: 4, y: 20 },
    ];
    const a = dense[0] as Vec2;
    const b = dense[3] as Vec2;
    const band = denseChordBand(dense, [a, b, dense[4] as Vec2])(a, b);
    expect(band?.above).toBeCloseTo(0.5, 9);
    expect(band?.below).toBeCloseTo(-0.3, 9);
  });

  it('stops the spline bowing a bar side between its end caps', () => {
    // Collapsed round end caps (no corners): each long side is one chord
    // whose neighbours turn hard, so the Catmull-Rom spline bows it.
    const { dense, vertices } = wobblyBar(120, 3);
    const unbanded = fitSmoothCurve(vertices, true, new Set(), 3, 0.9);
    const banded = fitSmoothCurve(
      vertices,
      true,
      new Set(),
      3,
      0.9,
      denseChordBand(dense, vertices),
    );
    const worst = (points: ReadonlyArray<Vec2>): number =>
      Math.max(
        ...points
          .filter((p) => p.x > 1 && p.x < 119)
          .map((p) => Math.min(Math.abs(p.y), Math.abs(p.y - 3))),
      );
    expect(worst(unbanded)).toBeGreaterThan(0.5);
    expect(worst(banded)).toBeLessThan(0.05);
  });
});
