// Code quality audit C2, D3 mutant T14: on a tapered part the surface feed of
// a move is matched at the cone's radius under the move's midpoint, not under
// its start. A move along X or round the part at one X hides the difference;
// a long diagonal stroke over a steep cone does not.
import { describe, expect, it } from 'vitest';
import type { RotaryTaperProfile } from '../job/rotary-taper-profile';
import { surfaceMatchedFeed, type RotaryFeedMatch } from './rotary-surface-feed';

const LAYER_FEED = 1500;
const REFERENCE_RADIUS = 35;
const Y_SCALE = 1.25;

// A cone from radius 30 mm at X 0 to radius 40 mm at X 40.
const CONE: RotaryTaperProfile = {
  referenceRadiusMm: REFERENCE_RADIUS,
  topX: 0,
  direction: 1,
  topRadiusMm: 30,
  bottomRadiusMm: 40,
  lengthMm: 40,
  baseY: 0,
};

const MATCH: RotaryFeedMatch = { yScale: Y_SCALE, maxFeedMmPerMin: 100_000, taper: CONE };

describe('taper surface feed on a diagonal stroke (C2 D3, T14)', () => {
  it('matches the feed at the radius under the midpoint of a 40 mm diagonal', () => {
    // 40 machine mm: 24 along the side, 32 of rotary Y.
    const from = { x: 0, y: 0 };
    const to = { x: 24, y: 32 };

    // Closed form, from the geometry alone. Machine Y turns the part by
    // dy / (k · R) rad; at the midpoint (X 12, radius 33) the surface travels
    // that angle times 33 mm round the part, and 24 mm along its side.
    const midRadius = 30 + (10 * 12) / 40;
    const roundMm = (32 / (Y_SCALE * REFERENCE_RADIUS)) * midRadius;
    const surfaceMm = Math.hypot(24, roundMm);
    const expected = (LAYER_FEED * 40) / surfaceMm;

    expect(midRadius).toBe(33);
    expect(surfaceMatchedFeed(LAYER_FEED, from, to, MATCH)).toBeCloseTo(expected, 6);
    // The same stroke matched at its start radius (30 mm) is a different feed,
    // so the assertion above pins the sampling point.
    const atStart = (LAYER_FEED * 40) / Math.hypot(24, (32 / (Y_SCALE * REFERENCE_RADIUS)) * 30);
    expect(Math.abs(atStart - expected)).toBeGreaterThan(20);
  });
});
