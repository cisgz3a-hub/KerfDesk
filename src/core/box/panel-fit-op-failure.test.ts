// R6: subtractCornerReliefs calls clipper2-ts' differenceD outside the F1
// boundary, so an internal clipper throw used to escape the pure core and abort
// the box generator. With clipper mocked to throw, applyPanelFit must report the
// degenerate contract classifyRings already uses, not propagate the throw.

import { describe, expect, it, vi } from 'vitest';

vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    differenceD: (): never => {
      throw new Error('clipper boom');
    },
  };
});

import { applyPanelFit, type PanelRings } from './panel-fit';

// An outline with an interior cutout: the cutout's corners are seat-critical
// (reflex corners of the surrounding material), so relief circles are generated
// and differenceD is reached.
const RINGS: PanelRings = {
  outline: {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  },
  cutouts: [
    {
      closed: true,
      points: [
        { x: 40, y: 40 },
        { x: 60, y: 40 },
        { x: 60, y: 60 },
        { x: 40, y: 60 },
      ],
    },
  ],
};

describe('applyPanelFit (R6 clipper boundary)', () => {
  it('reports degenerate instead of propagating a clipper throw', () => {
    const run = (): unknown =>
      applyPanelFit(RINGS, {
        clearanceMm: 0,
        relief: { kind: 'corner-overcut', toolDiameterMm: 6.35 },
      });
    expect(run).not.toThrow();
    const result = applyPanelFit(RINGS, {
      clearanceMm: 0,
      relief: { kind: 'corner-overcut', toolDiameterMm: 6.35 },
    });
    expect(result.kind).toBe('degenerate');
  });
});
