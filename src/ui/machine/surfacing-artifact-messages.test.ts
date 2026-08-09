import { describe, expect, it } from 'vitest';
import { surfacingCoverageWarning, surfacingPlanningWarning } from './surfacing-artifact-messages';

describe('surfacing artifact messages', () => {
  it('turns nominal row gaps into a nonblocking standalone warning', () => {
    expect(
      surfacingCoverageWarning({
        kind: 'nominal-gap',
        bitDiameterMm: 25.4,
        maxEmittedCenterGapMm: 50.8,
        nominalUncutGapMm: 25.4,
      }),
    ).toBe(
      'Surfacing rows leave a nominal uncut gap of 25.4 mm: the largest emitted row-center gap is 50.8 mm with a 25.4 mm bit. The warning does not prevent saving.',
    );
    expect(
      surfacingCoverageWarning({ kind: 'nominal-complete', maxEmittedCenterGapMm: 25.4 }),
    ).toBeNull();
  });

  it('turns structured pass-limit evidence into a nonblocking standalone warning', () => {
    expect(
      surfacingPlanningWarning({
        kind: 'pass-limit',
        stepoverPct: 0.001,
        stepMm: 0.000254,
        generatedRowsPerPass: 100_000,
        generatedPasses: 1,
        generatedRouteRows: 100_000,
        passLimit: 100_000,
        limitedStages: ['rows', 'depth-passes'],
        requestedYCoverageMm: 50,
        achievedYCoverageMm: 25.4,
        requestedDepthMm: 1.2,
        achievedDepthMm: 0.5,
      }),
    ).toBe(
      'Surfacing planning reached the 100000 route-row work limit before completing the requested area height and total depth. The generated program contains 1 pass(es) x 100000 row(s); the warning does not prevent saving.',
    );
    expect(
      surfacingPlanningWarning({
        kind: 'complete',
        stepoverPct: 40,
        stepMm: 10.16,
        generatedRowsPerPass: 6,
        generatedPasses: 3,
        generatedRouteRows: 18,
      }),
    ).toBeNull();
  });
});
