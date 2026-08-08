import { describe, expect, it } from 'vitest';
import type { Job } from '../../../core/job';
import { buildEffectiveOperationReview } from './job-review-effective-operations';

describe('buildEffectiveOperationReview', () => {
  it('deduplicates identical compiled laser groups while preserving distinct variants', () => {
    const base = {
      kind: 'cut' as const,
      layerId: 'red',
      color: '#ff0000',
      power: 15,
      speed: 1000,
      passes: 1,
      airAssist: false,
      powerMode: 'dynamic' as const,
      segments: [],
    };
    const job: Job = {
      groups: [base, base, { ...base, power: 30 }],
    };

    expect(buildEffectiveOperationReview(job)).toEqual([
      {
        layerId: 'red',
        summaries: [
          'Line · 15% power · 1,000 mm/min · 1 pass · air off · dynamic power',
          'Line · 30% power · 1,000 mm/min · 1 pass · air off · dynamic power',
        ],
      },
    ]);
  });

  it('reports the compiled CNC tool, pass count, feeds, RPM, and coolant', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cnc',
          layerId: 'blue',
          color: '#0000ff',
          cutType: 'profile-on-path',
          toolName: '3.175 mm end mill',
          toolDiameterMm: 3.175,
          feedMmPerMin: 800,
          plungeMmPerMin: 300,
          spindleRpm: 12_000,
          spindleSpinupSec: 2,
          coolant: 'flood',
          safeZMm: 5,
          passes: [
            {
              kind: 'contour',
              zMm: -1,
              polyline: [],
              closed: false,
            },
            {
              kind: 'contour',
              zMm: -2,
              polyline: [],
              closed: false,
            },
          ],
        },
      ],
    };

    expect(buildEffectiveOperationReview(job)).toEqual([
      {
        layerId: 'blue',
        summaries: [
          '3.175 mm end mill · 2 passes · 800 mm/min feed · 300 mm/min plunge · 12,000 RPM · flood coolant',
        ],
      },
    ]);
  });

  it('reports the actual compiled maximum depth for a flowing V-carve', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cnc',
          layerId: 'script',
          color: '#000000',
          cutType: 'v-carve',
          toolName: '90 degree V-bit',
          toolDiameterMm: 3.175,
          feedMmPerMin: 600,
          plungeMmPerMin: 250,
          spindleRpm: 12_000,
          spindleSpinupSec: 2,
          safeZMm: 5,
          passes: [
            {
              kind: 'path3d',
              closed: false,
              points: [
                { x: 0, y: 0, z: 0 },
                { x: 1, y: 0, z: -3.798 },
              ],
            },
          ],
        },
      ],
    };

    const review = buildEffectiveOperationReview(job)[0];
    expect(review?.summaries[0]).toBe(
      'Actual max depth 3.798 mm · 90 degree V-bit · 1 pass · 600 mm/min feed · ' +
        '250 mm/min plunge · 12,000 RPM · coolant off',
    );
    expect(review?.cncActualMaxDepthMm).toBe(3.798);
  });

  it('discloses exact relief depth without replacing the layer depth editor', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cnc',
          layerId: 'relief',
          color: '#a0522d',
          cutType: 'relief-finish',
          toolName: 'Ball nose',
          toolDiameterMm: 3.175,
          feedMmPerMin: 600,
          plungeMmPerMin: 250,
          spindleRpm: 12_000,
          spindleSpinupSec: 2,
          safeZMm: 5,
          passes: [
            {
              kind: 'path3d',
              closed: false,
              points: [
                { x: 0, y: 0, z: 0 },
                { x: 1, y: 0, z: -4.25 },
              ],
            },
          ],
        },
      ],
    };

    const review = buildEffectiveOperationReview(job)[0];
    expect(review?.summaries[0]).toContain('Actual max depth 4.25 mm');
    expect(review?.cncActualMaxDepthMm).toBeUndefined();
  });
});
