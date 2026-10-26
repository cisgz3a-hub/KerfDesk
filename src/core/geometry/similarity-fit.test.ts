import { describe, expect, it } from 'vitest';
import {
  applySimilarityPoint,
  solveTwoPointRegistration,
} from '../registration/similarity-transform';
import {
  applyFittedSimilarity,
  fitSimilarity,
  type FitPair,
  type FitPoint,
} from './similarity-fit';

const KNOWN = {
  scale: 1.7,
  rotationRad: Math.PI / 5,
  translation: { x: 42, y: -17 },
};
const POINTS: ReadonlyArray<FitPoint> = [
  { x: 0, y: 0 },
  { x: 30, y: 2 },
  { x: -8, y: 21 },
  { x: 17, y: -13 },
  { x: 44, y: 29 },
];

describe('fitSimilarity', () => {
  it.each([2, 5])('recovers an exact proper similarity from %i pairs', (count) => {
    const result = fitSimilarity(
      POINTS.slice(0, count).map((from) => ({
        from,
        to: applyFittedSimilarity(from, KNOWN),
      })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fit.transform.scale).toBeCloseTo(KNOWN.scale, 12);
    expect(result.fit.transform.rotationRad).toBeCloseTo(KNOWN.rotationRad, 12);
    expect(result.fit.transform.translation.x).toBeCloseTo(KNOWN.translation.x, 12);
    expect(result.fit.transform.translation.y).toBeCloseTo(KNOWN.translation.y, 12);
    expect(result.fit.maxResidualMm).toBeLessThan(1e-12);
  });

  it('matches the two-point registration solver', () => {
    const from = [POINTS[1]!, POINTS[3]!] as const;
    const to = from.map((point) => applyFittedSimilarity(point, KNOWN)) as [FitPoint, FitPoint];
    const fitted = fitSimilarity(from.map((point, index) => ({ from: point, to: to[index]! })));
    const solved = solveTwoPointRegistration({ design: from, machine: to });
    expect(fitted.ok && solved.ok).toBe(true);
    if (!fitted.ok || !solved.ok) return;
    expect(fitted.fit.transform.scale).toBeCloseTo(solved.transform.scale, 9);
    expect(fitted.fit.transform.rotationRad).toBeCloseTo(solved.transform.rotationRad, 9);
    for (const point of POINTS) {
      const actual = applyFittedSimilarity(point, fitted.fit.transform);
      const expected = applySimilarityPoint(point, solved.transform);
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
    }
  });

  it('reports small nonzero residuals for noisy data', () => {
    const pairs = POINTS.map((from, index) => {
      const to = applyFittedSimilarity(from, KNOWN);
      return { from, to: { x: to.x + index * 0.03, y: to.y - index * 0.02 } };
    });
    const result = fitSimilarity(pairs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fit.maxResidualMm).toBeGreaterThan(0);
    expect(result.fit.maxResidualMm).toBeLessThan(0.1);
    expect(result.fit.rmsResidualMm).toBeGreaterThan(0);
  });

  it('never turns a reflection into a proper fit', () => {
    const result = fitSimilarity(
      POINTS.map((from) => ({ from, to: { x: -from.x + 20, y: from.y - 4 } })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fit.maxResidualMm).toBeGreaterThan(10);
  });

  it.each<{ pairs: ReadonlyArray<FitPair> }>([
    { pairs: [] },
    { pairs: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }] },
    {
      pairs: [
        { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        { from: { x: 0.0001, y: 0 }, to: { x: 2, y: 1 } },
      ],
    },
    {
      pairs: [
        { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        { from: { x: 2, y: 0 }, to: { x: Number.NaN, y: 1 } },
      ],
    },
  ])('refuses degenerate input %#', ({ pairs }) => {
    expect(fitSimilarity(pairs)).toMatchObject({ ok: false });
  });
});
