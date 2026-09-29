// ADR-273 Amendment 2: a shape group records a ramp only where its passes
// ramp, so Job Review reads from the compiled job whether an operation's
// shapes use the ramp their layer asks for, and says so when they do not.

import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { CncGroup, Job } from '../../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
} from '../../../core/scene';
import { cncOperationDetail } from './job-review-detail-facts';
import { buildEffectiveOperationReview } from './job-review-effective-operations';

function cncGroup(cutType: CncGroup['cutType'], extra: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#2e8b57',
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

function layerWith(settings: CncLayerSettings): Layer {
  return { ...createLayer({ id: 'L1', color: '#2e8b57' }), cnc: settings };
}

function unrampedShapes(job: Job, settings: CncLayerSettings): unknown {
  const layers = [layerWith(settings)];
  return buildEffectiveOperationReview(job, { objects: [], layers })[0]?.unrampedShapes;
}

function ramped(settings: Partial<CncLayerSettings>): CncLayerSettings {
  return { ...DEFAULT_CNC_LAYER_SETTINGS, rampEntryDeg: 5, ...settings };
}

// The operation line for one layer, from the job compiled for it.
function compiledDetail(settings: CncLayerSettings): string {
  const artwork: ImportedSvg = {
    kind: 'imported-svg',
    id: 'artwork',
    source: 'artwork.svg',
    bounds: { minX: 20, minY: 20, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#2e8b57',
        polylines: [
          {
            closed: true,
            points: [
              { x: 20, y: 20 },
              { x: 40, y: 20 },
              { x: 40, y: 40 },
              { x: 20, y: 40 },
            ],
          },
        ],
      },
    ],
  };
  const scene = { objects: [artwork], layers: [layerWith(settings)] };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  const operation = buildEffectiveOperationReview(job, scene)[0];
  return cncOperationDetail(
    settings,
    undefined,
    operation?.plungingReliefStages,
    operation?.relief,
    operation?.unrampedShapes,
  );
}

describe('unramped entry in Job Review', () => {
  it('finds operations whose ramp request no compiled shape records', () => {
    const asked = ramped({ cutType: 'pocket' });
    expect(unrampedShapes({ groups: [cncGroup('drill')] }, asked)).toBe(true);
    expect(
      unrampedShapes({ groups: [cncGroup('pocket'), cncGroup('profile-outside')] }, asked),
    ).toBe(true);
    // A shape group that records a ramp cuts it.
    const rampedPocket = cncGroup('pocket', { rampEntryDeg: 5 });
    expect(unrampedShapes({ groups: [rampedPocket] }, asked)).toBeUndefined();
    // Relief stages have their own note (ADR-273 Amendment 1).
    const reliefs = [cncGroup('relief-rough'), cncGroup('relief-finish')];
    expect(unrampedShapes({ groups: reliefs }, asked)).toBeUndefined();
    // Nothing to qualify without a ramp request, and a V-carve discloses its own.
    const drill = [cncGroup('drill')];
    expect(unrampedShapes({ groups: drill }, DEFAULT_CNC_LAYER_SETTINGS)).toBeUndefined();
    const vCarve = [cncGroup('pocket'), cncGroup('v-carve')];
    expect(unrampedShapes({ groups: vCarve }, ramped({ cutType: 'v-carve' }))).toBeUndefined();
  });

  it('names the shapes the layer ramp does not reach', () => {
    const line = (settings: Partial<CncLayerSettings>, reliefs: 'relief-finish'[] = []): string =>
      cncOperationDetail(ramped(settings), undefined, reliefs, undefined, true);
    expect(line({ cutType: 'pocket', pocketStrategy: 'adaptive' })).toContain(
      ' · ramp entry 5° (not used by adaptive clearing) · ',
    );
    expect(line({ cutType: 'drill' })).toContain('ramp entry 5° (not used by drilling)');
    expect(line({ cutType: 'inlay-pair' })).toContain(
      'ramp entry 5° (not used by the inlay pocket or insert)',
    );
    const helix = { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 };
    expect(line({ cutType: 'pocket', helixEntry: helix })).toContain(
      'ramp entry 5° (not used by the helical pocket)',
    );
    expect(line({ cutType: 'pocket', pocketStrategy: 'adaptive' }, ['relief-finish'])).toContain(
      'ramp entry 5° (not used by adaptive clearing; relief finishing plunges)',
    );
  });

  it('qualifies only a ramp request', () => {
    const helix: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket',
      helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
    };
    expect(cncOperationDetail(helix, undefined, [], undefined, true)).toContain(
      ' · helix entry · ',
    );
    const vCarve: CncLayerSettings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'v-carve',
      vCarveRampEntryDeg: 3,
    };
    expect(cncOperationDetail(vCarve, undefined, [], undefined, true)).toContain(
      'requested entry 3° (medial depth profile governs) · ',
    );
    expect(cncOperationDetail(ramped({ cutType: 'pocket' }))).toContain(' · ramp entry 5° · ');
  });

  it('reads the note from the compiled job', () => {
    expect(compiledDetail(ramped({ cutType: 'drill', depthMm: 3 }))).toContain(
      'ramp entry 5° (not used by drilling)',
    );
    expect(
      compiledDetail(
        ramped({
          cutType: 'inlay-pair',
          depthMm: 6.35,
          inlayPocketDepthMm: 3,
          inlayAllowanceMm: 0.1,
          inlayPairSpacingMm: 10,
        }),
      ),
    ).toContain('ramp entry 5° (not used by the inlay pocket or insert)');
    // The offset pocket ramps and records it, so its line stays unqualified.
    expect(compiledDetail(ramped({ cutType: 'pocket', depthMm: 3 }))).toContain(
      ' · ramp entry 5° · ',
    );
  });
});
