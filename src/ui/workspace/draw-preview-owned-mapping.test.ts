import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import type * as CoreJob from '../../core/job';
import type { Job, RasterGroup, Toolpath } from '../../core/job';
import type { DeviceProfile } from '../../core/devices';
import { createProject } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { buildPreviewToolpathFromPrepared } from './draw-preview';
import { previewRouteSource } from './executable-plan-preview-route';
import { mapToolpathToScene, previewJobOriginOffset } from './preview-scene-frame';

const observed = vi.hoisted(() => ({
  routes: [] as Array<{ readonly route: Toolpath; readonly original: Toolpath }>,
}));
vi.mock('../../core/job', async (original) => {
  const actual = await original<typeof CoreJob>();
  return {
    ...actual,
    buildToolpath: (...args: Parameters<typeof actual.buildToolpath>) => {
      const route = actual.buildToolpath(...args);
      observed.routes.push({ route, original: structuredClone(route) });
      return route;
    },
  };
});
beforeEach(() => {
  observed.routes.length = 0;
});

const origins: DeviceProfile['origin'][] = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];

describe('fresh streamed-raster preview mapping', () => {
  it.each(origins)('reuses its fresh array and preserves the exact mixed route (%s)', (origin) => {
    const base = createProject();
    const project = { ...base, device: { ...base.device, origin } };
    const offset = { x: -13.125, y: 7.0625 };
    const job = mixedJob(true);
    const prepared = { ok: true as const, project, job, jobOriginOffset: offset };
    freezeGeometry(prepared);

    const preview = buildPreviewToolpathFromPrepared(project, prepared, undefined, {
      executablePlan: true,
    });

    expect(observed.routes).toHaveLength(1);
    const built = observed.routes[0];
    if (built === undefined) throw new Error('missing original machine route');
    expect(preview).toEqual(mapToolpathToScene(built.original, offset, project.device));
    expect(preview.steps).toBe(built.route.steps);
    expect(previewJobOriginOffset(preview)).toBe(offset);
    expect(previewRouteSource(preview)).toBe('legacy-toolpath');
    expect(
      preview.steps.some((step) => step.kind === 'cut' && step.source?.kind === 'raster'),
    ).toBe(true);
    expect(preview.steps.some((step) => step.kind === 'cut' && step.zs !== undefined)).toBe(true);
    expect(preview.steps.some((step) => step.kind === 'plunge' && step.toolId === 'bit')).toBe(
      true,
    );
    // The prepared job can be reused: shared vector/CNC points and row data
    // retain machine coordinates, and a fresh build maps them only once.
    expect(buildPreviewToolpathFromPrepared(project, prepared)).toEqual(preview);
  });

  it('keeps separate machine geometry for an ordinary executable-plan comparison', () => {
    const project = projectWithLine();
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    const preview = buildPreviewToolpathFromPrepared(project, prepared, undefined, {
      executablePlan: true,
    });
    const built = observed.routes[0];
    if (built === undefined) throw new Error('missing original machine route');
    expect(built.route).toEqual(built.original);
    expect(preview.steps).not.toBe(built.route.steps);
    expect(previewRouteSource(preview)).toBe('executable-plan');
  });

  it('keeps the pure mapper for embedded raster jobs', () => {
    const project = createProject();
    const prepared = {
      ok: true as const,
      project,
      job: mixedJob(false),
      jobOriginOffset: { x: 3.5, y: -2.25 },
    };
    const preview = buildPreviewToolpathFromPrepared(project, prepared);
    const built = observed.routes[0];
    if (built === undefined) throw new Error('missing original machine route');
    expect(built.route).toEqual(built.original);
    expect(preview.steps).not.toBe(built.route.steps);
    expect(preview).toEqual(
      mapToolpathToScene(built.original, prepared.jobOriginOffset, project.device),
    );
  });
});

function mixedJob(streamed: boolean): Job {
  const values = new Float64Array([600, 0, 450, 0, 500, 0, 600, 0]);
  const raster: RasterGroup = {
    kind: 'raster',
    layerId: 'image',
    sourceObjectId: 'image-object',
    source: 'pixels.png',
    color: '#808080',
    power: 60,
    speed: 700,
    passes: 2,
    airAssist: false,
    pixelWidth: 4,
    pixelHeight: 2,
    sValues: streamed ? new Float64Array(0) : values,
    ...(streamed ? { rowProvider: (y: number) => values.slice(y * 4, (y + 1) * 4) } : {}),
    bounds: { minX: 12.25, minY: 16.5, maxX: 14.25, maxY: 17.5 },
    overscanMm: 0.5,
    dotWidthCorrectionMm: 0.125,
    bidirectional: true,
    bidirectionalScanOffsetMm: 0.03125,
  };
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'vector',
        color: '#ff0000',
        power: 30,
        speed: 500,
        passes: 1,
        airAssist: false,
        segments: [
          {
            closed: false,
            polyline: [
              { x: -0, y: 1.25 },
              { x: 2.125, y: -3.5 },
            ],
          },
        ],
      },
      raster,
      {
        kind: 'cnc',
        layerId: 'cnc',
        color: '#333333',
        cutType: 'engrave',
        toolId: 'bit',
        toolDiameterMm: 1,
        feedMmPerMin: 500,
        plungeMmPerMin: 100,
        spindleRpm: 8000,
        spindleSpinupSec: 0,
        safeZMm: 3,
        passes: [
          {
            kind: 'path3d',
            closed: false,
            points: [
              { x: 7.125, y: 3.5, z: -0.25 },
              { x: 8.5, y: 2.125, z: -1.5 },
              { x: 9.25, y: 4.5, z: -0.75 },
            ],
          },
        ],
      },
    ],
  };
}

function freezeGeometry(value: unknown): void {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return;
  for (const child of Object.values(value)) freezeGeometry(child);
  Object.freeze(value);
}
