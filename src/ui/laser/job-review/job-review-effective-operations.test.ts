import { describe, expect, it } from 'vitest';
import type { Job } from '../../../core/job';
import { parseGrblCncCoordinate } from '../../../core/cnc/cnc-grbl-coordinate-parser';
import { captureLayerOperationSettings, createLayer } from '../../../core/scene';
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
    expect(review?.cncActualMaxDepthMm).toBe(parseGrblCncCoordinate('3.798'));
  });

  it('discloses an ordinary requested depth that differs from represented output', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cnc',
          layerId: 'shallow-engrave',
          color: '#000000',
          cutType: 'engrave',
          toolName: 'Engraving bit',
          toolDiameterMm: 3.175,
          requestedDepthMm: 0.0506,
          depthPerPassMm: 0.0506,
          feedMmPerMin: 600,
          plungeMmPerMin: 250,
          spindleRpm: 12_000,
          spindleSpinupSec: 2,
          safeZMm: 5,
          passes: [
            {
              kind: 'contour',
              zMm: -0.0506,
              polyline: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };

    expect(buildEffectiveOperationReview(job)[0]?.summaries[0]).toContain(
      'Emitted max depth 0.051 mm (0.0506 requested)',
    );
  });

  it('does not format represented GRBL float storage into a different emitted depth', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cnc',
          layerId: 'deep-engrave',
          color: '#000000',
          cutType: 'engrave',
          toolName: 'Engraving bit',
          toolDiameterMm: 3.175,
          requestedDepthMm: 6553.605,
          feedMmPerMin: 600,
          plungeMmPerMin: 250,
          spindleRpm: 12_000,
          spindleSpinupSec: 2,
          safeZMm: 5,
          passes: [
            {
              kind: 'contour',
              zMm: -6553.606,
              polyline: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };

    expect(buildEffectiveOperationReview(job)[0]?.summaries[0]).toContain(
      'Emitted max depth 6,553.606 mm (6553.605 requested)',
    );
  });

  it('does not report a false requested/emitted mismatch from GRBL float storage', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cnc',
          layerId: 'exact-engrave',
          color: '#000000',
          cutType: 'engrave',
          toolDiameterMm: 3.175,
          requestedDepthMm: 0.1,
          feedMmPerMin: 600,
          plungeMmPerMin: 250,
          spindleRpm: 12_000,
          spindleSpinupSec: 2,
          safeZMm: 5,
          passes: [
            {
              kind: 'contour',
              zMm: -0.1,
              polyline: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };

    expect(buildEffectiveOperationReview(job)[0]?.summaries[0]).not.toContain('Emitted max depth');
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

  it('discloses the requested feed when compilation caps the emitted feed', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'material-test-row-0',
          color: '#100000',
          power: 30,
          speed: 2000,
          requestedSpeed: 3000,
          passes: 1,
          airAssist: false,
          overscanMm: 5,
          segments: [],
        },
      ],
    };

    expect(buildEffectiveOperationReview(job)[0]?.summaries[0]).toContain(
      '2,000 mm/min effective (3,000 requested)',
    );
  });

  it('reports the effective compiled contour-entry target', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'outline',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          airAssist: false,
          entryRunwayMm: 2,
          segments: [],
        },
      ],
    };

    expect(buildEffectiveOperationReview(job)[0]?.summaries[0]).toContain(
      'contour entry 2 mm effective (laser off)',
    );
  });

  it('reports effective object-local fill facts instead of only the base operation', () => {
    const operationSettings = captureLayerOperationSettings({
      ...createLayer({ id: 'base', color: '#000000', mode: 'fill' }),
      fillStyle: 'offset',
      hatchSpacingMm: 0.35,
      hatchAngleDeg: 45,
      fillBidirectional: false,
      fillCrossHatch: true,
    });
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'base',
          color: '#000000',
          power: 30,
          speed: 1200,
          passes: 1,
          airAssist: false,
          operationSettings,
          overscanMm: 5,
          segments: [],
        },
      ],
    };

    expect(buildEffectiveOperationReview(job)[0]?.summaries[0]).toContain(
      'effective override: Offset fill · 0.35 mm hatch at 45° · one-way · cross-hatch',
    );
  });

  it('maps a named artwork from its requested operation to the exact effective override', () => {
    const base = createLayer({ id: 'base', color: '#000000', mode: 'line' });
    const effective = captureLayerOperationSettings({ ...base, mode: 'fill', fillStyle: 'offset' });
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'base',
          sourceObjectId: 'art',
          color: '#000000',
          power: 30,
          speed: 1000,
          passes: 1,
          airAssist: false,
          operationSettings: effective,
          overscanMm: 5,
          segments: [],
        },
      ],
    };
    const object = {
      kind: 'imported-svg' as const,
      id: 'art',
      source: 'named-artwork.svg',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        mirrorX: false,
        mirrorY: false,
      },
      paths: [],
    };

    expect(
      buildEffectiveOperationReview(job, { objects: [object], layers: [base] })[0]?.summaries[0],
    ).toContain(
      'named-artwork — Fill · 30% power · 1,000 mm/min · 1 pass · air off · requested Operation; effective artwork override: Offset fill',
    );
  });
});
