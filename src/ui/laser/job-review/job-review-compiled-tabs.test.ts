// ADR-258 Amendment 4 (second CNC audit P2-toolpath-2): Job Review's tab line.
// A tab no thinner than the set stock is cut half the stock thick, and the line
// says so rather than promising the full height; it names tabs only where the
// compiled passes carry them, since an open path never takes one.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../core/geometry/vec3';
import type { CncGroup } from '../../../core/job';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings } from '../../../core/scene';
import { cncOperationDetail } from './job-review-detail-facts';
import { buildEffectiveOperationReview } from './job-review-effective-operations';

describe('cncOperationDetail tabs (ADR-258 Amendment 4)', () => {
  it('says when a tab no thinner than the stock is thinned to half the stock', () => {
    const settings: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside',
      depthMm: 2.3,
      depthPerPassMm: 1,
      tabsEnabled: true,
    };
    expect(cncOperationDetail(settings, 2)).toContain(
      'tabs 4 per shape (6 × 2 mm) above the stock bottom, thinned to 1 mm (half the 2 mm stock)',
    );
    expect(cncOperationDetail({ ...settings, depthMm: 2 }, 2)).toContain(
      'thinned to 1 mm (half the 2 mm stock)',
    );
    expect(cncOperationDetail({ ...settings, depthMm: 3.2, tabHeightMm: 3 }, 3)).toContain(
      'tabs 4 per shape (6 × 3 mm) above the stock bottom, thinned to 1.5 mm (half the 3 mm stock)',
    );
    // A tab thinner than the stock keeps its height.
    expect(cncOperationDetail({ ...settings, depthMm: 3.3 }, 3)).not.toContain('thinned');
    // A floor at least as thick as the thinned tab holds the part.
    expect(cncOperationDetail({ ...settings, depthMm: 0.8 }, 2)).toContain(
      'tabs 4 per shape (6 × 2 mm), skipped: the 1.2 mm floor holds the part',
    );
  });

  it('names no tabs when a cut this deep compiled none', () => {
    const through: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      depthMm: 6.6,
      depthPerPassMm: 2,
      tabsEnabled: true,
    };
    const open = cncOperationDetail(through, 6, [], undefined, false, false);
    expect(open).toBe('4 passes · stepover 40% · Manual feeds');
    expect(cncOperationDetail(through, 6, [], undefined, false, true)).toContain(
      ' · tabs 4 per shape (6 × 2 mm) above the stock bottom · ',
    );
    // Without a compiled job the line reads the settings, as before.
    expect(cncOperationDetail(through, 6)).toContain('above the stock bottom');
    // A cut no deeper than a tab gets none from any shape (ADR-258), and the
    // line keeps reporting the configured tabs.
    expect(
      cncOperationDetail(DEFAULT_CNC_LAYER_SETTINGS, undefined, [], undefined, false, false),
    ).toContain(' · tabs 4 per shape (6 × 2 mm) · ');
  });
});

describe('buildEffectiveOperationReview tabbedShapes (ADR-258 Amendment 4)', () => {
  // The review names tabs only where a compiled profile pass climbs a tab wall,
  // a vertical rise at one XY. A ramp or an open line descends along its path
  // and marks nothing.
  it('marks the operations whose compiled profile passes rise into a tab', () => {
    const profile = (layerId: string, points: ReadonlyArray<Vec3>): CncGroup => ({
      kind: 'cnc',
      layerId,
      color: '#0000ff',
      cutType: 'profile-outside',
      toolDiameterMm: 3.175,
      feedMmPerMin: 800,
      plungeMmPerMin: 300,
      spindleRpm: 12_000,
      spindleSpinupSec: 2,
      safeZMm: 5,
      passes: [{ kind: 'path3d', closed: false, points }],
    });
    const tabbed = [
      { x: 0, y: 0, z: -2 },
      { x: 10, y: 0, z: -2 },
      { x: 10, y: 0, z: -1 },
      { x: 16, y: 0, z: -1 },
      { x: 16, y: 0, z: -2 },
      { x: 30, y: 0, z: -2 },
    ];
    const ramped = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: -1 },
      { x: 30, y: 0, z: -2 },
    ];
    const review = buildEffectiveOperationReview({
      groups: [profile('tabbed', tabbed), profile('ramped', ramped)],
    });

    expect(review.find((entry) => entry.layerId === 'tabbed')?.tabbedShapes).toBe(true);
    expect(review.find((entry) => entry.layerId === 'ramped')).not.toHaveProperty('tabbedShapes');
  });
});
