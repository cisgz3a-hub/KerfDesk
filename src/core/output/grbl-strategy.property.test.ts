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
import type { Job } from '../job';
import {
  arbLaserJob,
  arbMixedLaserJob,
  OUTPUT_BED_HEIGHT,
  OUTPUT_BED_WIDTH,
  OUTPUT_FUZZ_RUNS,
} from './__fixtures__/laser-job-arbitraries';

describe('grblStrategy property tests', () => {
  it('is deterministic across 100 fuzz seeds', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    fc.assert(
      fc.property(arbLaserJob, (job) => {
        const a = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        const b = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        return a === b;
      }),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('emits zero laser-on-travel issues across 100 random jobs', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    fc.assert(
      fc.property(arbLaserJob, (job) => {
        const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        return findLaserOnTravelIssues(out).length === 0;
      }),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('emits zero out-of-bed coords across 100 in-bounds random jobs', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    fc.assert(
      fc.property(arbLaserJob, (job) => {
        const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        const issues = findOutOfBoundsCoords(out, {
          width: OUTPUT_BED_WIDTH,
          height: OUTPUT_BED_HEIGHT,
        });
        return issues.length === 0;
      }),
      { numRuns: OUTPUT_FUZZ_RUNS },
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
          airAssist: false,
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
          airAssist: false,
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(findLaserOnTravelIssues(out)).toEqual([]);
    expect(out).not.toMatch(/^M[34] S[1-9]/m);
  });

  it('is deterministic across 100 fuzz seeds INCLUDING fill groups (continuous-sweep path)', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    fc.assert(
      fc.property(arbMixedLaserJob, (job) => {
        const a = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        const b = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        return a === b;
      }),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('emits zero laser-on-travel issues across 100 random jobs WITH fill groups', async () => {
    const { grblStrategy } = await import('./grbl-strategy');
    fc.assert(
      fc.property(arbMixedLaserJob, (job) => {
        const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        return findLaserOnTravelIssues(out).length === 0;
      }),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });
});
