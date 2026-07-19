import { describe, expect, it } from 'vitest';
import { bestFitCircleFromRimPoints } from './board-circle-fit';

describe('bestFitCircleFromRimPoints', () => {
  it('finds the center and diameter from four well-spaced rim points', () => {
    const fit = bestFitCircleFromRimPoints([
      { x: 100, y: 50 },
      { x: 150, y: 100 },
      { x: 100, y: 150 },
      { x: 50, y: 100 },
    ]);
    expect(fit?.center.x).toBeCloseTo(100, 8);
    expect(fit?.center.y).toBeCloseTo(100, 8);
    expect(fit?.diameterMm).toBeCloseTo(100, 8);
    expect(fit?.maxErrorMm).toBeCloseTo(0, 8);
    expect(fit?.coverageDeg).toBeCloseTo(270, 8);
  });

  it('averages small capture noise and reports its residual', () => {
    const fit = bestFitCircleFromRimPoints([
      { x: 100.4, y: 50 },
      { x: 150, y: 99.5 },
      { x: 99.7, y: 150 },
      { x: 50, y: 100.3 },
    ]);
    expect(fit?.center.x).toBeCloseTo(100, 0);
    expect(fit?.center.y).toBeCloseTo(100, 0);
    expect(fit?.diameterMm).toBeCloseTo(100, 0);
    expect(fit?.maxErrorMm ?? 99).toBeLessThan(1);
  });

  it('rejects fewer than four, non-finite, collinear, and clustered points', () => {
    expect(
      bestFitCircleFromRimPoints([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBeNull();
    expect(
      bestFitCircleFromRimPoints([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ]),
    ).toBeNull();
    expect(
      bestFitCircleFromRimPoints([
        { x: Number.NaN, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ]),
    ).toBeNull();
    expect(
      bestFitCircleFromRimPoints([
        { x: 100, y: 0 },
        { x: 98, y: 17 },
        { x: 94, y: 34 },
        { x: 87, y: 50 },
      ]),
    ).toBeNull();
    expect(
      bestFitCircleFromRimPoints([
        { x: 10, y: 0 },
        { x: 0, y: 10 },
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBeNull();
  });
});
