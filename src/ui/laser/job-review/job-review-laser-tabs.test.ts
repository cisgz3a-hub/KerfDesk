import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { compileJob } from '../../../core/job/compile-job';
import { createLayer, IDENTITY_TRANSFORM, type Layer } from '../../../core/scene';
import { laserOperationDetail } from './job-review-detail-facts';
import { buildEffectiveOperationReview } from './job-review-effective-operations';
import { laserTabsPart } from './job-review-laser-tabs';

const TABS: Layer = {
  ...createLayer({ id: 'L1', color: '#ff0000' }),
  tabsEnabled: true,
  tabsPerShape: 4,
  tabSizeMm: 0.5,
};

describe('Job Review laser tab wording (ADR-494)', () => {
  it('reads as before for an operation that never set the new settings', () => {
    expect(laserTabsPart(TABS)).toBe('tabs 4 × 0.5 mm');
    expect(laserTabsPart({ ...TABS, tabsEnabled: false }, 3)).toBe('tabs off');
    expect(laserOperationDetail(TABS)).toContain(' · tabs 4 × 0.5 mm · ');
  });

  it('names spacing, its cap, the tab power and the tabs placed by hand', () => {
    expect(
      laserTabsPart({
        ...TABS,
        tabLayout: 'spacing',
        tabSpacingMm: 50,
        tabMaxPerShape: 6,
        tabCutPowerPercent: 20,
      }),
    ).toBe('tabs every 50 mm (at most 6) × 0.5 mm, cut at 20%');
    expect(laserTabsPart({ ...TABS, tabLayout: 'spacing' })).toBe('tabs every 50 mm × 0.5 mm');
    expect(laserTabsPart(TABS, 3)).toBe('tabs 4 × 0.5 mm, 3 placed by hand');
    expect(laserOperationDetail({ ...TABS, tabCutPowerPercent: 12.5 }, 2)).toContain(
      'tabs 4 × 0.5 mm, cut at 12.5%, 2 placed by hand',
    );
  });

  it('names the group that burns the tabs apart from its cut', () => {
    const layer: Layer = { ...TABS, power: 50, tabCutPowerPercent: 20 };
    const job = compileJob(
      {
        objects: [
          {
            kind: 'imported-svg',
            id: 'part',
            source: 'part.svg',
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 0, y: 0 },
                      { x: 10, y: 0 },
                      { x: 10, y: 10 },
                      { x: 0, y: 10 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        layers: [layer],
      },
      DEFAULT_DEVICE_PROFILE,
    );
    const [review] = buildEffectiveOperationReview(job);
    expect(review?.summaries).toHaveLength(2);
    expect(review?.summaries[0]).toMatch(/^Line · 50% power/);
    expect(review?.summaries[1]).toMatch(/^Line tabs \(20% of cut power\) · 10% power/);
  });
});
