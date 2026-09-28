import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, KNOWN_CONTROLLER_KINDS } from '../../core/devices';
import type { FillGroup, Job, RasterGroup } from '../../core/job';
import { createLayer, createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { detectJobIntentWarnings } from './job-intent-warnings';
import { scanQualityWarnings } from './scan-quality-warnings';

const project = {
  ...createProject(DEFAULT_DEVICE_PROFILE),
  scene: {
    objects: [],
    layers: [createLayer({ id: 'image', name: 'Detail', color: '#000000', mode: 'image' })],
  },
};

function raster(patch: Partial<RasterGroup> = {}): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'image',
    source: 'detail.png',
    color: '#000000',
    power: 30,
    speed: 1500,
    passes: 1,
    airAssist: false,
    sValues: Float64Array.of(300),
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 10, minY: 10, maxX: 10.1, maxY: 10.1 },
    overscanMm: 5,
    dotWidthCorrectionMm: 0,
    ...patch,
  };
}

function warnings(group: RasterGroup | FillGroup): ReadonlyArray<string> {
  return scanQualityWarnings({ groups: [group] }, project);
}

describe('compiled scan quality advisories', () => {
  it.each(KNOWN_CONTROLLER_KINDS)('uses the same saved-motion model for %s', (controllerKind) => {
    const result = scanQualityWarnings(
      { groups: [raster({ speed: 6000 })] },
      { ...project, device: { ...project.device, controllerKind } },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('at most 5 mm of scan-entry runway');
    expect(result[0]).toContain('needs about 10 mm to reach that speed from rest');
    expect(result[0]).toContain('not a measured machine limit');
  });

  it('uses emitted feed, not requested feed, and clears when runway is sufficient', () => {
    expect(warnings(raster({ speed: 1500, requestedSpeed: 6000 }))).toEqual([]);
    expect(warnings(raster({ speed: 6000, overscanMm: 10 }))).toEqual([]);
    expect(warnings(raster({ speed: 6000.9, overscanMm: 10 }))).toEqual([]);
  });

  it('measures the run-up along an angled scan (ADR-495)', () => {
    // 6000 mm/min needs 10 mm along an axis, 7.07 mm on a diagonal.
    expect(warnings(raster({ speed: 6000, overscanMm: 7.8, scanAngleDeg: 45 }))).toEqual([]);
    const short = warnings(raster({ speed: 6000, overscanMm: 5, scanAngleDeg: 45 }));
    expect(short).toHaveLength(1);
    expect(short[0]).toContain('500 mm/s² (707.1068 mm/s² along its 45° scan)');
    expect(short[0]).toContain('needs about 7.0711 mm');
    expect(warnings(raster({ speed: 6000, overscanMm: 7.8, scanAngleDeg: 90 }))).toHaveLength(1);
  });

  it('compares the qualified Fill entry rather than its larger stored setting', () => {
    const fill: FillGroup = {
      kind: 'fill',
      layerId: 'image',
      color: '#000000',
      power: 30,
      speed: 6000,
      passes: 1,
      airAssist: false,
      overscanMm: 20,
      fillStyle: 'scanline',
      fillRunwayPolicy: 'feed-matched-entry',
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
          ],
          closed: false,
          reverse: false,
        },
      ],
    };
    expect(warnings(fill)[0]).toContain('at most 5 mm');
    expect(warnings({ ...fill, fillRunwayPolicy: 'feed-matched-every-sweep' })).toEqual([]);
    expect(warnings({ ...fill, fillStyle: 'offset' })).toEqual([]);
  });

  it('reports deletion of isolated dots at half the horizontal pitch', () => {
    expect(warnings(raster({ dotWidthCorrectionMm: 0.05 }))[0]).toContain(
      'removes an isolated one-pixel powered run',
    );
    expect(warnings(raster({ dotWidthCorrectionMm: 0.025 }))).toEqual([]);
  });

  it('uses the horizontal pitch of anisotropic pass-through output', () => {
    const group = raster({ pixelWidth: 10, dotWidthCorrectionMm: 0.01 });
    expect(warnings(group)[0]).toContain('0.01 mm pixels along the scan');
    expect(warnings(group)[0]).toContain('removes an isolated one-pixel powered run');
  });

  it('discloses coordinate collapse before all floating-point width is gone', () => {
    expect(warnings(raster({ dotWidthCorrectionMm: 0.04975 }))[0]).toContain(
      'can disappear when coordinates are rounded',
    );
  });

  it('does not consume streamed pixels or alter the compiled job', () => {
    const rowProvider = vi.fn(() => Float64Array.of(300));
    const group = raster({ dotWidthCorrectionMm: 0.05, rowProvider, sValues: new Float64Array() });
    const job: Job = { groups: [group] };
    const before = { ...group };
    expect(scanQualityWarnings(job, project)).toHaveLength(1);
    expect(rowProvider).not.toHaveBeenCalled();
    expect(group).toEqual(before);
  });

  it('deduplicates copies and skips zero-power or CNC work', () => {
    const group = raster({ speed: 6000 });
    expect(scanQualityWarnings({ groups: [group, group] }, project)).toHaveLength(1);
    expect(warnings({ ...group, power: 0 })).toEqual([]);
    expect(
      scanQualityWarnings({ groups: [group] }, { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG }),
    ).toEqual([]);
  });

  it('reaches the existing Job Review warning collection without changing authorization', () => {
    expect(detectJobIntentWarnings(project, { groups: [raster({ speed: 6000 })] })).toContain(
      warnings(raster({ speed: 6000 }))[0],
    );
  });
});
