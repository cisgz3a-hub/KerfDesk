// Lead fitting checked between its samples (ADR-626 Amd 6): a lead-out that
// only grazes its lead-in, and a contour that burns as arcs past its chords.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { leadFits, retracesLeadIn, type LeadFit } from './laser-lead-fit';
import { LeadObstacles } from './laser-lead-obstacles';
import { leadPath } from './laser-lead-path';

function fit(points: ReadonlyArray<Vec2>): LeadFit {
  return {
    path: { points, moves: [], freeEnd: points[points.length - 1] as Vec2 },
    shortened: false,
  };
}

describe('lead fitting between samples (ADR-626)', () => {
  it('catches a lead-out that grazes the lead-in between two of its samples', () => {
    // The lead-out runs along y = 0 from (0, 0); the lead-in has a corner
    // 0.199 mm above it, midway between the 1.00 and 1.05 mm samples, which
    // are both a little over 0.2 mm from it.
    const leadOut = fit([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    const leadIn = fit([
      { x: 0.025, y: 1.2 },
      { x: 1.025, y: 0.199 },
      { x: 5, y: 5 },
    ]);
    expect(retracesLeadIn(leadOut, leadIn, 0.2)).toBe(true);
    expect(retracesLeadIn(leadOut, leadIn, 0.19)).toBe(false);
  });

  it('measures the step that crosses the clearance from the lead-out start', () => {
    // With a 0.22 mm clearance the walking step from 0.20 to 0.25 mm crosses
    // it; the lead-in's corner 0.2195 mm above 0.225 mm is too close to that
    // part of the step, though the next step is clear of it.
    const leadOut = fit([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    const leadIn = fit([
      { x: -1, y: 2 },
      { x: 0.225, y: 0.2195 },
      { x: -1, y: 5 },
    ]);
    expect(retracesLeadIn(leadOut, leadIn, 0.22)).toBe(true);
  });

  it('checks the crossing against the contour as it burns, not its chords', () => {
    // The chords are a plain square; as it burns, a 0.01 mm tongue hangs from
    // its bottom edge just behind the join, which the lead-in would cut.
    const chords = [
      { x: 1, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const burn = [
      { x: 1, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 0.98, y: 0 },
      { x: 0.98, y: -2 },
      { x: 0.99, y: -2 },
      { x: 0.99, y: 0 },
      { x: 1, y: 0 },
    ];
    const join = { at: { x: 1, y: 0 }, tangent: { x: 1, y: 0 }, scrap: { x: 0, y: -1 } };
    const lead = leadPath('in', join, { style: 'arc', lengthMm: 2, angleDeg: 90 });
    const context = (ownBurn: ReadonlyArray<Vec2>) => ({
      obstacles: LeadObstacles.create([burn], []),
      ownLine: 0,
      ownRing: chords,
      ownBurn,
      ignoredLines: new Set([0]),
      ignoredRings: new Set<number>(),
      inside: false,
      clearanceMm: 0.2,
      bed: null,
      arcsEmitted: false,
      ringHoldsContour: () => false,
    });
    expect(leadFits(lead, 'in', join, context(chords))).toBe(true);
    expect(leadFits(lead, 'in', join, context(burn))).toBe(false);
  });
});
