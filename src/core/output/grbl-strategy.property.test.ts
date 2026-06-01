// Property tests for grblStrategy.
//
// Covers Phase A acceptance criteria (PROJECT.md "Vertical slice — Phase A
// acceptance"):
//   * Determinism property — 100 fuzz seeds, same input → identical output.
//   * Laser-off invariant — every G0 line has S0 or precedes M5/sticky-S0.
//   * Bounds invariant — output coords inside the configured bed.
//   * Power-scale invariant — 50% slider × $30 ∈ {100, 255, 1000} → correct S.
//
// The arbitraries below build in-bounds Jobs so the bounds invariant has a
// hope of holding. The strategy itself doesn't clamp — that's JobCompiler /
// preflight's job — so this test exercises the "happy path".

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  collectG1SValues,
  expectedS,
  findLaserOnTravelIssues,
  findOutOfBoundsCoords,
} from '../invariants';
import type { CutSegment, Job } from '../job';

const FUZZ_RUNS = 100;
const BED_WIDTH = DEFAULT_DEVICE_PROFILE.bedWidth;
const BED_HEIGHT = DEFAULT_DEVICE_PROFILE.bedHeight;

const arbVec2InBed = fc.record({
  x: fc.double({
    min: 0,
    max: BED_WIDTH,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  y: fc.double({
    min: 0,
    max: BED_HEIGHT,
    noNaN: true,
    noDefaultInfinity: true,
  }),
});

const arbSegment: fc.Arbitrary<CutSegment> = fc.record({
  polyline: fc.array(arbVec2InBed, { minLength: 2, maxLength: 12 }),
  closed: fc.boolean(),
});

const arbGroup = fc.record({
  kind: fc.constant('cut' as const),
  layerId: fc.string({ minLength: 1, maxLength: 4 }),
  color: fc.constantFrom('#ff0000', '#00ff00', '#0000ff', '#000000'),
  power: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  speed: fc.double({
    min: 1,
    max: DEFAULT_DEVICE_PROFILE.maxFeed,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  passes: fc.integer({ min: 1, max: 3 }),
  segments: fc.array(arbSegment, { minLength: 0, maxLength: 4 }),
});

const arbJob: fc.Arbitrary<Job> = fc.record({
  groups: fc.array(arbGroup, { minLength: 0, maxLength: 3 }),
});

describe('grblStrategy property tests', () => {
  it('is deterministic across 100 fuzz seeds', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    fc.assert(
      fc.property(arbJob, (job) => {
        const a = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        const b = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        return a === b;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it('emits zero laser-on-travel issues across 100 random jobs', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    fc.assert(
      fc.property(arbJob, (job) => {
        const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        return findLaserOnTravelIssues(out).length === 0;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it('emits zero out-of-bed coords across 100 in-bounds random jobs', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    fc.assert(
      fc.property(arbJob, (job) => {
        const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        const issues = findOutOfBoundsCoords(out, {
          width: BED_WIDTH,
          height: BED_HEIGHT,
        });
        return issues.length === 0;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it('power-scale: 50% × $30 ∈ {100, 255, 1000} produces the correct S', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'L1',
          color: '#000000',
          power: 50,
          speed: 1500,
          passes: 1,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    for (const maxPowerS of [100, 255, 1000]) {
      const dev = { ...DEFAULT_DEVICE_PROFILE, maxPowerS };
      const out = grblStrategy.emit(job, dev);
      const sValues = collectG1SValues(out);
      expect(sValues).toContain(expectedS(50, maxPowerS));
      // No surprises: every G1 S in this single-layer job equals the expected.
      for (const s of sValues) expect(s).toBe(expectedS(50, maxPowerS));
    }
  });

  it('keeps fill overscan runway laser-off', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 50,
          speed: 1500,
          passes: 1,
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(findLaserOnTravelIssues(out)).toEqual([]);
    expect(out).not.toMatch(/^M[34] S[1-9]/m);
  });
});
