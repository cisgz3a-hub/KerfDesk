// The executable regression bar for the landed centerline rework slice.
// Runs the real centerline tracer on ground-truth strokes and asserts the
// improvements already shipped by ADR-058: straight/diagonal/cross strokes stay
// tightly centered, junctions are chained, and known unfinished corner/arc
// behavior is capped so it cannot regress quietly while the follow-up thinning
// work remains pending.
//
// Per CLAUDE.md rule 2, a metric like this (render/measure vs known truth) is
// the real proof, not a green structural suite.

import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToCenterlinePaths } from '../../core/trace';
import { measureCenterlineDeviation } from './centerline-deviation';
import { CENTERLINE_TRUTH_FIXTURES } from './centerline-truth';

const CENTERLINE_OPTIONS = TRACE_PRESETS['Centerline']!;

type CenterlineRegressionLimit = {
  readonly maxDeviationPx: number;
  readonly maxGapPx: number;
  readonly maxFragmentCount: number;
};

const STRICT_LIMIT: CenterlineRegressionLimit = {
  maxDeviationPx: 1,
  maxGapPx: 2,
  maxFragmentCount: 1,
};

const CENTERLINE_REGRESSION_LIMITS: Readonly<Record<string, CenterlineRegressionLimit>> = {
  'h-stroke': STRICT_LIMIT,
  'diagonal-stroke': STRICT_LIMIT,
  cross: {
    maxDeviationPx: 1,
    maxGapPx: 2,
    maxFragmentCount: 2,
  },
  // ADR-058 documents corner centering and arc fragmentation as pending
  // thinning-quality work; these limits preserve the landed behavior without
  // claiming that the final 1px/connected bar is complete.
  'l-corner': {
    maxDeviationPx: 1.6,
    maxGapPx: 2,
    maxFragmentCount: 1,
  },
  arc: {
    maxDeviationPx: 1,
    maxGapPx: 3.5,
    maxFragmentCount: 4,
  },
};

describe('centerline trace meets the landed regression bar', () => {
  for (const fixture of CENTERLINE_TRUTH_FIXTURES) {
    it(`${fixture.name}: stays inside its current regression limits`, () => {
      const traced = traceImageToCenterlinePaths(fixture.image, CENTERLINE_OPTIONS);
      const metric = measureCenterlineDeviation(traced, fixture);
      const limit = CENTERLINE_REGRESSION_LIMITS[fixture.name] ?? STRICT_LIMIT;
      // Surfaced so the baseline and every iteration are visible in the run log.
      console.log(`[centerline-bar] ${fixture.name}`, JSON.stringify(metric));
      expect(metric.maxDeviationPx).toBeLessThanOrEqual(limit.maxDeviationPx);
      expect(metric.maxGapPx).toBeLessThanOrEqual(limit.maxGapPx);
      expect(metric.shortFragmentCount).toBe(0);
      expect(metric.fragmentCount).toBeLessThanOrEqual(limit.maxFragmentCount);
    });
  }
});
