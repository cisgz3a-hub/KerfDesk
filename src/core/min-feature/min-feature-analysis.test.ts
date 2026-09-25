import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { analyzeMinimumFeatures, type MinFeaturePath } from './min-feature-analysis';

const BOTH = { checkWidths: true, checkGaps: true } as const;

function rect(x0: number, y0: number, x1: number, y1: number, clockwise = false): MinFeaturePath {
  const points: Vec2[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ];
  return { points: clockwise ? points.reverse() : points, closed: true };
}

function circle(cx: number, cy: number, radius: number, segments = 48): MinFeaturePath {
  const points: Vec2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return { points, closed: true };
}

/** A 70 × 20 mm stencil sheet with four 10 mm square holes in a row, the
 * material between neighbouring holes being a bridge `bridgeMm` wide. */
function stencil(bridgeMm: number, clockwiseHoles = true): MinFeaturePath[] {
  const holes = [0, 1, 2, 3].map((i) => {
    const x0 = 5 + i * (10 + bridgeMm);
    return rect(x0, 5, x0 + 10, 15, clockwiseHoles);
  });
  return [rect(0, 0, 70, 20), ...holes];
}

describe('analyzeMinimumFeatures', () => {
  it('reports 0.1 mm stencil bridges under a 0.15 mm kerf as three narrow parts', () => {
    const result = analyzeMinimumFeatures(stencil(0.1), { thresholdMm: 0.15, ...BOTH });
    expect(result.complete).toBe(true);
    expect(result.widths.count).toBe(3);
    expect(result.widths.minWidthMm).toBeCloseTo(0.1, 9);
    expect(result.gaps.count).toBe(0);
    const xs = result.widths.sites.map((site) => site.at.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(15.05, 6);
    expect(xs[1]).toBeCloseTo(25.15, 6);
    expect(xs[2]).toBeCloseTo(35.25, 6);
    for (const site of result.widths.sites) {
      expect(site.at.y).toBeGreaterThanOrEqual(5);
      expect(site.at.y).toBeLessThanOrEqual(15);
    }
  });

  it('does not depend on the winding of the holes', () => {
    const result = analyzeMinimumFeatures(stencil(0.1, false), { thresholdMm: 0.15, ...BOTH });
    expect(result.widths.count).toBe(3);
    expect(result.gaps.count).toBe(0);
  });

  it('reports nothing for 0.3 mm bridges under a 0.15 mm kerf', () => {
    const result = analyzeMinimumFeatures(stencil(0.3), { thresholdMm: 0.15, ...BOTH });
    expect(result.widths.count).toBe(0);
    expect(result.gaps.count).toBe(0);
    expect(result.complete).toBe(true);
  });

  it('reports shapes 0.1 mm apart as one gap', () => {
    const result = analyzeMinimumFeatures([rect(0, 0, 10, 10), rect(10.1, 0, 20.1, 10)], {
      thresholdMm: 0.15,
      ...BOTH,
    });
    expect(result.gaps.count).toBe(1);
    expect(result.gaps.minWidthMm).toBeCloseTo(0.1, 9);
    expect(result.gaps.sites[0]?.at.x).toBeCloseTo(10.05, 6);
    expect(result.widths.count).toBe(0);
  });

  it('does not treat the corners of ordinary shapes as features', () => {
    const shapes = [rect(0, 0, 10, 10), circle(30, 5, 5), rect(50, 0, 50.5, 0.5)];
    const result = analyzeMinimumFeatures(shapes, { thresholdMm: 0.15, ...BOTH });
    expect(result.widths.count).toBe(0);
    expect(result.gaps.count).toBe(0);
  });

  it('reports the tip of a 20 degree spike but not a 60 degree one', () => {
    const spike = (apexDeg: number): MinFeaturePath => {
      const half = ((apexDeg / 2) * Math.PI) / 180;
      const height = 1 / Math.tan(half);
      return {
        closed: true,
        points: [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: height },
        ],
      };
    };
    const sharp = analyzeMinimumFeatures([spike(20)], { thresholdMm: 0.15, ...BOTH });
    expect(sharp.widths.count).toBe(1);
    expect(sharp.gaps.count).toBe(0);
    const blunt = analyzeMinimumFeatures([spike(60)], { thresholdMm: 0.15, ...BOTH });
    expect(blunt.widths.count).toBe(0);
    expect(blunt.gaps.count).toBe(0);
  });

  it('reports a hole narrower than the kerf as a gap and a thin strip as a part', () => {
    const sheet = rect(0, 0, 20, 20);
    const hole = circle(5, 5, 0.05, 24);
    const strip = rect(10, 10, 18, 10.08);
    const result = analyzeMinimumFeatures([sheet, hole, strip], { thresholdMm: 0.15, ...BOTH });
    expect(result.gaps.count).toBe(2);
    expect(result.gaps.minWidthMm).toBeCloseTo(0.08, 9);
    expect(result.gaps.sites.some((site) => Math.abs(site.widthMm - 0.1) < 0.005)).toBe(true);
    expect(result.widths.count).toBe(0);
    // The strip is a separate closed shape inside the sheet: it is a hole in
    // the sheet (even-odd), so its 0.08 mm interior is a gap, not material.
    expect(result.gaps.sites.some((site) => Math.abs(site.widthMm - 0.08) < 1e-9)).toBe(true);
  });

  it('reports a free-standing thin part and honours the requested sides', () => {
    const strip = rect(0, 0, 8, 0.08);
    const widthsOnly = analyzeMinimumFeatures([strip], {
      thresholdMm: 0.15,
      checkWidths: true,
      checkGaps: false,
    });
    expect(widthsOnly.widths.count).toBe(1);
    expect(widthsOnly.widths.minWidthMm).toBeCloseTo(0.08, 9);
    const gapsOnly = analyzeMinimumFeatures([strip], {
      thresholdMm: 0.15,
      checkWidths: false,
      checkGaps: true,
    });
    expect(gapsOnly.widths.count).toBe(0);
    expect(gapsOnly.gaps.count).toBe(0);
  });

  it('reports open lines closer than the kerf as a gap', () => {
    const lines: MinFeaturePath[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        closed: false,
      },
      {
        points: [
          { x: 0, y: 0.1 },
          { x: 10, y: 0.1 },
        ],
        closed: false,
      },
    ];
    const result = analyzeMinimumFeatures(lines, { thresholdMm: 0.15, ...BOTH });
    expect(result.gaps.count).toBe(1);
    expect(result.gaps.minWidthMm).toBeCloseTo(0.1, 9);
  });

  it('reports a 2 mm slot for a 3 mm tool', () => {
    const slot = rect(0, 0, 2, 5);
    const result = analyzeMinimumFeatures([slot], {
      thresholdMm: 3,
      checkWidths: true,
      checkGaps: false,
    });
    expect(result.widths.count).toBe(1);
    expect(result.widths.minWidthMm).toBeCloseTo(2, 9);
  });

  it('stops within its budget on a large job and says the result is partial', () => {
    const squares: MinFeaturePath[] = [];
    for (let row = 0; row < 40; row += 1) {
      for (let column = 0; column < 40; column += 1) {
        squares.push(rect(column * 3, row * 3, column * 3 + 2.95, row * 3 + 2.95));
      }
    }
    const budget = { maxPieces: 1_000_000, maxPairTests: 50_000 };
    const limited = analyzeMinimumFeatures(squares, { thresholdMm: 0.15, ...BOTH }, budget);
    expect(limited.complete).toBe(false);
    expect(limited.work.pairTests).toBeLessThanOrEqual(budget.maxPairTests);
    // What was checked before the budget ran out is still reported.
    expect(limited.gaps.count).toBeGreaterThan(0);

    const started = performance.now();
    const full = analyzeMinimumFeatures(squares, { thresholdMm: 0.15, ...BOTH });
    const elapsedMs = performance.now() - started;
    expect(full.complete).toBe(true);
    expect(full.work.pairTests).toBeLessThanOrEqual(4_000_000);
    // Neighbouring squares are 0.05 mm apart everywhere, so the gaps join
    // into features through the pieces they share.
    expect(full.gaps.count).toBeGreaterThan(0);
    expect(full.gaps.minWidthMm).toBeCloseTo(0.05, 9);
    expect(full.widths.count).toBe(0);
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it('caps pieces and reports the rest as unchecked', () => {
    const result = analyzeMinimumFeatures(
      stencil(0.1),
      { thresholdMm: 0.15, ...BOTH },
      { maxPieces: 10, maxPairTests: 1_000_000 },
    );
    expect(result.complete).toBe(false);
  });
});
