import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { leadFits } from './laser-lead-fit';
import { LeadObstacles } from './laser-lead-obstacles';
import { leadPath } from './laser-lead-path';

const JOIN = {
  at: { x: 0, y: 0 },
  tangent: { x: 1, y: 0 },
  scrap: { x: 0, y: -1 },
};
const RING = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
  { x: 0, y: 0 },
];

function fitsBesideShortCut(clearanceMm: number): boolean {
  const lead = leadPath('out', JOIN, { style: 'line', lengthMm: 2, angleDeg: 45 });
  // The closest approach is midway between the 1.00 and 1.05 mm samples.
  // Its endpoints are both more than 0.2 mm from those samples at 0.199 mm
  // perpendicular clearance, although the continuous lead is too close.
  const at = (alongMm: number): Vec2 => ({
    x: Math.SQRT1_2 * (alongMm + clearanceMm),
    y: Math.SQRT1_2 * (-alongMm + clearanceMm),
  });
  const obstacle = [at(1.0245), at(1.0255)];
  return leadFits(lead, 'out', JOIN, {
    obstacles: LeadObstacles.create([RING, obstacle], []),
    ownLine: 0,
    ownRing: RING,
    ownBurn: RING,
    ignoredLines: new Set([0]),
    ignoredRings: new Set(),
    inside: false,
    clearanceMm: 0.2,
    bed: null,
    arcsEmitted: false,
    ringHoldsContour: () => false,
  });
}

describe('continuous laser lead clearance', () => {
  it('rejects a close approach between walking samples', () => {
    expect(fitsBesideShortCut(0.199)).toBe(false);
  });

  it('keeps the full lead when its continuous path clears the cut', () => {
    expect(fitsBesideShortCut(0.201)).toBe(true);
  });

  it('detects an interior crossing and respects ignored copies', () => {
    const crossing = [
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
    ];
    const obstacles = LeadObstacles.create([RING, crossing], []);
    const from = { x: 0, y: 0 };
    const to = { x: 1, y: 0 };
    expect(obstacles.otherLinesClear(from, to, 0.2, 0, new Set([0]))).toBe(false);
    expect(obstacles.otherLinesClear(from, to, 0.2, 0, new Set([0, 1]))).toBe(true);
  });

  it.each<[number, boolean]>([
    [0.199, false],
    [0.2, true],
    [0.201, true],
  ])('measures wide parallel cuts at %s mm without grid subdivision', (gap, expected) => {
    const wide = [
      { x: -2000, y: gap },
      { x: 2000, y: gap },
    ];
    const obstacles = LeadObstacles.create([RING, wide], []);
    expect(obstacles.otherLinesClear({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.2, 0, new Set([0]))).toBe(
      expected,
    );
  });
});
