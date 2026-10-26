import { describe, expect, it } from 'vitest';
import type { Job } from '../../../core/job';
import { buildEffectiveOperationReview } from './job-review-effective-operations';

// Rolling audit v2 03-P2-6 (ADR-239 Amendment 1): with the bed's position in
// program coordinates unknown (ADR-343) the emitter adds no contour entry, so
// the operation line must not call one effective.
function lineJob(contourEntryBounds: Job['contourEntryBounds']): Job {
  return {
    ...(contourEntryBounds === undefined ? {} : { contourEntryBounds }),
    groups: [
      {
        kind: 'cut',
        layerId: 'outline',
        color: '#000000',
        power: 30,
        speed: 1500,
        passes: 1,
        airAssist: false,
        entryRunwayMm: 5,
        segments: [],
      },
    ],
  };
}

describe('effective operation contour entry', () => {
  it('reports a skipped contour entry when the bed position is unknown', () => {
    const summary = buildEffectiveOperationReview(lineJob(null))[0]?.summaries[0];

    expect(summary).toContain('contour entry not added (bed position unknown)');
    expect(summary).not.toContain('effective (laser off)');
  });

  it('keeps the effective wording with a known or archived envelope', () => {
    const known = lineJob({ minX: 0, minY: 0, maxX: 400, maxY: 400 });

    expect(buildEffectiveOperationReview(known)[0]?.summaries[0]).toContain(
      'contour entry 5 mm effective (laser off)',
    );
    expect(buildEffectiveOperationReview(lineJob(undefined))[0]?.summaries[0]).toContain(
      'contour entry 5 mm effective (laser off)',
    );
  });
});
