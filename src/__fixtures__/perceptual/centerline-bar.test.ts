// The executable bar for the centerline tracer (ADR-058). Runs the real tracer
// on ground-truth strokes and asserts: smooth strokes are centered within 1px of
// the true centre, the whole stroke is covered (no breaks), strokes stay
// connected through junctions (fragmentCount <= expected), and there are no spur
// stubs. Per CLAUDE.md rule 2, a render/measure-vs-known-truth metric like this
// is the real proof, not a green structural suite.
//
// The one relaxed case is the hard 90deg corner: Zhang-Suen thinning retracts
// the skeleton at convex corners (~1.5px), a thinning limit independent of the
// extraction (the divide-and-conquer can only trace the skeleton it is given).
// Sharpening corners is a future slice (ADR-058 2c).

import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToCenterlinePaths } from '../../core/trace';
import { measureCenterlineDeviation } from './centerline-deviation';
import { CENTERLINE_TRUTH_FIXTURES } from './centerline-truth';

const CENTERLINE_OPTIONS = TRACE_PRESETS['Centerline']!;

const MAX_DEVIATION_PX = 1;
// Hard 90deg corners sit at the Zhang-Suen thinning limit (~1.5px); see header.
const CORNER_DEVIATION_PX = 1.6;
const MAX_GAP_PX = 2;

describe('centerline trace meets the pixel-centering bar', () => {
  for (const fixture of CENTERLINE_TRUTH_FIXTURES) {
    it(`${fixture.name}: centered, connected, spur-free`, () => {
      const traced = traceImageToCenterlinePaths(fixture.image, CENTERLINE_OPTIONS);
      const metric = measureCenterlineDeviation(traced, fixture);
      // Surfaced so the baseline and every iteration are visible in the run log.
      console.log(`[centerline-bar] ${fixture.name}`, JSON.stringify(metric));
      const maxDeviation = fixture.name === 'l-corner' ? CORNER_DEVIATION_PX : MAX_DEVIATION_PX;
      expect(metric.maxDeviationPx).toBeLessThanOrEqual(maxDeviation);
      expect(metric.maxGapPx).toBeLessThanOrEqual(MAX_GAP_PX);
      expect(metric.shortFragmentCount).toBe(0);
      expect(metric.fragmentCount).toBeLessThanOrEqual(fixture.expectedStrokeCount);
    });
  }
});
