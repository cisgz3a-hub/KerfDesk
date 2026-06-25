// The executable bar for the centerline rework (feat/centerline-rework).
// Runs the real centerline tracer on ground-truth strokes and asserts
// pixel-perfect centering: the traced line runs within 1px of the true center,
// covers the whole stroke (no breaks), stays connected through junctions
// (fragmentCount <= expected), and has no spur stubs.
//
// This is RED against the legacy Zhang-Suen + pixel-walk pipeline by design —
// it documents the gap and turns green only when the rework meets the bar.
// Per CLAUDE.md rule 2, a metric like this (render/measure vs known truth) is
// the real proof, not a green structural suite.

import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToCenterlinePaths } from '../../core/trace';
import { measureCenterlineDeviation } from './centerline-deviation';
import { CENTERLINE_TRUTH_FIXTURES } from './centerline-truth';

const CENTERLINE_OPTIONS = TRACE_PRESETS['Centerline']!;

const MAX_DEVIATION_PX = 1;
const MAX_GAP_PX = 2;

describe('centerline trace meets the pixel-centering bar', () => {
  for (const fixture of CENTERLINE_TRUTH_FIXTURES) {
    it(`${fixture.name}: centered within 1px, connected, spur-free`, () => {
      const traced = traceImageToCenterlinePaths(fixture.image, CENTERLINE_OPTIONS);
      const metric = measureCenterlineDeviation(traced, fixture);
      // Surfaced so the baseline and every iteration are visible in the run log.
      console.log(`[centerline-bar] ${fixture.name}`, JSON.stringify(metric));
      expect(metric.maxDeviationPx).toBeLessThanOrEqual(MAX_DEVIATION_PX);
      expect(metric.maxGapPx).toBeLessThanOrEqual(MAX_GAP_PX);
      expect(metric.shortFragmentCount).toBe(0);
      expect(metric.fragmentCount).toBeLessThanOrEqual(fixture.expectedStrokeCount);
    });
  }
});
