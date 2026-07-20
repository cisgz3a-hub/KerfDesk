import { describe, expect, it } from 'vitest';
import { createLayer } from '../../../core/scene';
import type { Job } from '../../../core/job';
import { buildOutputQualityReviewFacts } from './job-review-live-rows';

describe('buildOutputQualityReviewFacts', () => {
  it('shows exact runway coverage and the effective 4040 fallback reason', () => {
    const layer = {
      ...createLayer({ id: 'small-text', color: '#000000', mode: 'fill' }),
      name: 'Small text',
    };
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: layer.id,
          color: layer.color,
          power: 30,
          speed: 1500,
          passes: 2,
          airAssist: false,
          fillStyle: 'scanline',
          fillRunwayPolicy: 'full',
          scanDirection: {
            bidirectional: false,
            reason: 'uncalibrated-4040-fallback',
          },
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 10, y: 10 },
                { x: 13, y: 10 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };

    expect(buildOutputQualityReviewFacts(job, [layer])).toEqual([
      {
        label: 'Fill runway coverage',
        value: 'requested 5 mm · 2 full · 0 partial · 0 skipped · 0 disabled (2 emitted sweeps)',
        tone: 'default',
      },
      {
        label: 'Fill direction — Small text',
        value: 'One-way — 4040 fallback; no scan-offset calibration',
        tone: 'warning',
      },
    ]);
  });

  it('explains that sensitive Island Fill remains one-way', () => {
    const layer = {
      ...createLayer({ id: 'islands', color: '#000000', mode: 'fill' }),
      name: 'Tiny islands',
    };
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: layer.id,
          color: layer.color,
          power: 30,
          speed: 1500,
          passes: 1,
          airAssist: false,
          fillStyle: 'island',
          fillRunwayPolicy: 'full',
          islandMotionPolicy: 'sensitive',
          scanDirection: {
            bidirectional: false,
            reason: 'sensitive-island-one-way',
          },
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 10, y: 10 },
                { x: 13, y: 10 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };

    expect(buildOutputQualityReviewFacts(job, [layer])).toContainEqual({
      label: 'Fill direction — Tiny islands',
      value: 'One-way — sensitive Island Fill policy',
      tone: 'warning',
    });
  });

  it('distinguishes an explicit zero baseline from a saved-table verification coupon', () => {
    const baseline = createLayer({ id: 'baseline', color: '#330000', mode: 'fill' });
    const verification = createLayer({ id: 'verification', color: '#330001', mode: 'fill' });
    const fillGroup = (
      layerId: string,
      reason: 'calibration-baseline' | 'calibration-verification',
    ) => ({
      kind: 'fill' as const,
      layerId,
      color: '#330000',
      power: 10,
      speed: 1500,
      passes: 1,
      airAssist: false,
      fillStyle: 'scanline' as const,
      fillRunwayPolicy: 'full' as const,
      scanDirection: { bidirectional: true, reason },
      overscanMm: 0,
      segments: [],
    });
    const job: Job = {
      groups: [
        fillGroup(baseline.id, 'calibration-baseline'),
        fillGroup(verification.id, 'calibration-verification'),
      ],
    };

    expect(buildOutputQualityReviewFacts(job, [baseline, verification])).toEqual([
      {
        label: 'Fill direction — Operation',
        value: 'Bidirectional — uncorrected calibration baseline (explicit 0 mm)',
        tone: 'warning',
      },
      {
        label: 'Fill direction — Operation',
        value: 'Bidirectional — verification coupon using saved calibration table',
        tone: 'default',
      },
    ]);
  });
});
