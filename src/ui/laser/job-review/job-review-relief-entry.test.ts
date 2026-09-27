// ADR-273 Amendment 1: a relief group records a ramp only where it ramps, so
// Job Review reads from the compiled groups which relief stages plunge and
// says so beside the entry the layer requests for its other shapes.

import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../../../core/job';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings } from '../../../core/scene';
import { cncOperationDetail } from './job-review-detail-facts';
import { buildEffectiveOperationReview } from './job-review-effective-operations';

function cncGroup(cutType: CncGroup['cutType'], extra: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'relief',
    color: '#a0522d',
    cutType,
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12_000,
    spindleSpinupSec: 2,
    safeZMm: 5,
    passes: [],
    ...extra,
  };
}

function plungingStages(job: Job): unknown {
  return buildEffectiveOperationReview(job)[0]?.plungingReliefStages;
}

const RAMPED: CncLayerSettings = { ...DEFAULT_CNC_LAYER_SETTINGS, rampEntryDeg: 5 };

describe('relief entry in Job Review', () => {
  it('finds the compiled relief stages that plunge', () => {
    expect(
      plungingStages({ groups: [cncGroup('relief-rough'), cncGroup('relief-finish')] }),
    ).toEqual(['relief-rough', 'relief-finish']);
    // A relief group that records a ramp cuts it, so it is left out.
    expect(
      plungingStages({
        groups: [cncGroup('relief-rough', { rampEntryDeg: 5 }), cncGroup('relief-finish')],
      }),
    ).toEqual(['relief-finish']);
    expect(plungingStages({ groups: [cncGroup('profile-on-path')] })).toBeUndefined();
  });

  it('says which relief stages plunge beside the layer ramp', () => {
    expect(cncOperationDetail(RAMPED)).toContain(' · ramp entry 5° · ');
    expect(cncOperationDetail(RAMPED, undefined, ['relief-rough', 'relief-finish'])).toContain(
      ' · ramp entry 5° (relief passes plunge) · ',
    );
    expect(cncOperationDetail(RAMPED, undefined, ['relief-rough'])).toContain(
      'ramp entry 5° (relief roughing plunges)',
    );
    expect(cncOperationDetail(RAMPED, undefined, ['relief-finish'])).toContain(
      'ramp entry 5° (relief finishing plunges)',
    );
  });

  it('qualifies helix and V-carve entry requests, and adds nothing without a request', () => {
    const both = ['relief-rough', 'relief-finish'] as const;
    const helix: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket',
      helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
    };
    expect(cncOperationDetail(helix, undefined, both)).toContain(
      'helix entry (relief passes plunge)',
    );
    const vCarve: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'v-carve',
      vCarveRampEntryDeg: 3,
    };
    expect(cncOperationDetail(vCarve, undefined, both)).toContain(
      'requested entry 3° (medial depth profile governs; relief passes plunge)',
    );
    expect(cncOperationDetail(DEFAULT_CNC_LAYER_SETTINGS, undefined, both)).not.toContain('plunge');
  });
});
