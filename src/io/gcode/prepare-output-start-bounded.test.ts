import { describe, expect, it, vi } from 'vitest';
import type { CutGroup, FillGroup, Job, RasterGroup } from '../../core/job';
import { DEFAULT_OUTPUT_SCOPE, createProject, type Project } from '../../core/scene';
import { completePreparedOutput } from './prepare-output';

const cut: CutGroup = {
  kind: 'cut',
  layerId: 'line',
  color: '#000000',
  power: 50,
  speed: 1000,
  passes: 1,
  airAssist: false,
  segments: [
    {
      closed: true,
      polyline: [
        { x: 20, y: 20 },
        { x: 30, y: 20 },
        { x: 30, y: 30 },
        { x: 20, y: 30 },
        { x: 20, y: 20 },
      ],
    },
  ],
};

function raster(
  rowProvider: NonNullable<RasterGroup['rowProvider']>,
  height = 100000,
): RasterGroup {
  return {
    ...cut,
    kind: 'raster',
    pixelWidth: 1,
    pixelHeight: height,
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: height },
    sValues: new Uint16Array(),
    rowProvider,
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  };
}

function prepare(job: Job, relative = true) {
  const base = createProject();
  const project: Project = {
    ...base,
    device: { ...base.device, origin: 'front-left' },
    optimization: { ...base.optimization, travelPolicy: 'source-order' },
    ...(relative ? { startPoints: { job: { x: 1, y: 0, relative: true as const } } } : {}),
  };
  return completePreparedOutput(
    {
      ok: true,
      sourceProject: project,
      project,
      options: {},
      outputScope: DEFAULT_OUTPUT_SCOPE,
      advisories: [],
    },
    job,
  );
}

describe('bounded preparation of relative cutting starts', () => {
  it('stops at the first emitting row when a streamed raster owns the generated start', () => {
    const rowProvider = vi.fn((index: number) => {
      if (index > 0) throw new Error('later raster rows must remain lazy');
      return new Uint16Array([500]);
    });
    const job = { groups: [raster(rowProvider), cut] };
    const automatic = prepare(job, false);
    expect(rowProvider).not.toHaveBeenCalled();
    expect(prepare(job).job).toEqual(automatic.job);
    expect(rowProvider.mock.calls).toEqual([[0]]);
  });

  it('does not read a later raster at all when scanline fill owns the generated start', () => {
    const rowProvider = vi.fn(() => {
      throw new Error('later raster must remain lazy');
    });
    const fill: FillGroup = {
      ...cut,
      kind: 'fill',
      overscanMm: 0,
      segments: [
        {
          closed: false,
          reverse: false,
          polyline: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
          ],
        },
      ],
    };
    const job = { groups: [fill, raster(rowProvider), cut] };
    expect(prepare(job).job).toEqual(prepare(job, false).job);
    expect(rowProvider).not.toHaveBeenCalled();
  });

  it('still applies relative starts to a later cut after checking an empty raster', () => {
    const rowProvider = vi.fn((_index: number) => new Uint16Array([0]));
    const prepared = prepare({ groups: [raster(rowProvider, 2), cut] });
    const selected = prepared.job.groups[1];
    expect(selected?.kind).toBe('cut');
    if (selected?.kind !== 'cut') throw new Error('missing cut');
    expect(selected.segments[0]?.polyline[0]).toEqual({ x: 30, y: 30 });
    expect(new Set(rowProvider.mock.calls.map(([index]) => index))).toEqual(new Set([0, 1]));
  });
});
